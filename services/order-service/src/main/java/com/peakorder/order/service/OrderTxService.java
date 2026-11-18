package com.peakorder.order.service;

import com.peakorder.order.client.InventoryClient.StockHold;
import com.peakorder.order.client.MenuClient.PurchaseLine;
import com.peakorder.order.client.MenuClient.ValidatedMenu;
import com.peakorder.order.dto.OrderDetailResponse;
import com.peakorder.order.entity.Order;
import com.peakorder.order.entity.OrderItemOption;
import com.peakorder.order.entity.OrderStatus;
import com.peakorder.order.exception.BusinessException;
import com.peakorder.order.exception.ErrorCode;
import com.peakorder.order.messaging.OrderConfirmedEvent;
import com.peakorder.order.repository.OrderNoRepository;
import com.peakorder.order.repository.OrderRepository;
import com.peakorder.order.repository.OutboxEventRepository;
import java.time.Clock;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;

/** 주문 저장 단위 트랜잭션. 외부 서비스 호출 동안 DB 트랜잭션을 잡고 있지 않도록 OrderService와 분리했다. */
@Service
public class OrderTxService {

  /** 외부 호출 타임아웃(연결 2초·읽기 3초)으로 환불까지 이어져도 끝나는 시간보다 충분히 길게 잡는다. */
  static final java.time.Duration PAY_LOCK_TTL = java.time.Duration.ofSeconds(60);

  private static final DateTimeFormatter ORDER_NO_DATE = DateTimeFormatter.ofPattern("yyMMdd");

  private final OrderRepository orderRepository;
  private final OrderNoRepository orderNoRepository;
  private final OutboxEventRepository outboxEventRepository;
  private final JsonMapper jsonMapper;
  private final Clock clock;

  public OrderTxService(
      OrderRepository orderRepository,
      OrderNoRepository orderNoRepository,
      OutboxEventRepository outboxEventRepository,
      JsonMapper jsonMapper,
      Clock clock) {
    this.orderRepository = orderRepository;
    this.orderNoRepository = orderNoRepository;
    this.outboxEventRepository = outboxEventRepository;
    this.jsonMapper = jsonMapper;
    this.clock = clock;
  }

  public record PricedLine(
      Long menuId, String menuName, int unitPrice, int quantity, List<OrderItemOption> options) {}

  /** 결제 진행 여부를 판단하는 데 필요한 값. 외부 호출 전에 읽어 두고 트랜잭션을 닫는다. */
  public record PaymentTarget(
      Long id,
      OrderStatus status,
      int totalAmount,
      Long holdId,
      OffsetDateTime holdExpiresAt,
      OffsetDateTime paymentRequestedAt,
      List<PurchaseLine> lines,
      OrderDetailResponse detail) {}

  @Transactional
  public Long createTemporaryOrder(Long userId, List<PricedLine> lines) {
    Order order = Order.createTemporary(userId, now());
    for (PricedLine line : lines) {
      order.addItem(
          line.menuId(), line.menuName(), line.unitPrice(), line.quantity(), line.options());
    }
    return orderRepository.save(order).getId();
  }

  @Transactional
  public OrderDetailResponse markHeld(Long orderId, StockHold hold) {
    Order order =
        orderRepository
            .findById(orderId)
            .orElseThrow(() -> new BusinessException(ErrorCode.ORDER_NOT_FOUND));
    order.markHeld(hold.holdId(), hold.expiresAt(), now());
    return OrderDetailResponse.from(order);
  }

  @Transactional(readOnly = true)
  public PaymentTarget findPaymentTarget(Long userId, Long orderId) {
    Order order =
        orderRepository
            .findByIdAndUserId(orderId, userId)
            .orElseThrow(() -> new BusinessException(ErrorCode.ORDER_NOT_FOUND));
    return new PaymentTarget(
        order.getId(),
        order.getStatus(),
        order.getTotalAmount(),
        order.getHoldId(),
        order.getHoldExpiresAt(),
        order.getPaymentRequestedAt(),
        order.getItems().stream()
            .map(
                i ->
                    new PurchaseLine(
                        i.getMenuId(),
                        i.getQuantity(),
                        i.getOptions().stream().map(OrderItemOption::getOptionId).toList()))
            .toList(),
        OrderDetailResponse.from(order));
  }

  /**
   * 결제·재고 확정 완료 처리. 행 잠금을 잡고 아직 CREATED일 때만 PAID로 바꾸며, 주문번호 발급과 OrderConfirmed outbox 저장을 같은 트랜잭션에서
   * 한다. 이미 확정된 주문이면 아무것도 바꾸지 않고 현재 상태를 돌려준다(중복 호출 방지).
   */
  @Transactional
  public OrderDetailResponse confirmOrder(Long orderId, Long paymentId, List<ValidatedMenu> menus) {
    Order order =
        orderRepository
            .findWithLockById(orderId)
            .orElseThrow(() -> new BusinessException(ErrorCode.ORDER_NOT_FOUND));
    if (order.getStatus() != OrderStatus.CREATED) {
      return OrderDetailResponse.from(order);
    }
    OffsetDateTime now = now();
    order.markConfirmed(issueOrderNo(LocalDate.now(clock)), paymentId, now);

    UUID eventId = UUID.randomUUID();
    String payload =
        jsonMapper.writeValueAsString(OrderConfirmedEvent.from(order, eventId, now, menus));
    outboxEventRepository.insertPending(eventId, OrderConfirmedEvent.EVENT_TYPE, payload, now);
    return OrderDetailResponse.from(order);
  }

  /**
   * 결제를 요청하기 직전에 호출한다(별도 트랜잭션). 기록에 실패하면 예외가 나므로 결제는 요청되지 않는다. 이미 기록돼 있으면 처음 시각을 유지한다. 주문이 더 이상
   * CREATED가 아니면 기록하지 않고 false를 돌려주며, 호출자는 결제를 요청하지 않아야 한다.
   */
  @Transactional
  public boolean markPaymentRequested(Long orderId) {
    return orderRepository
        .findWithLockById(orderId)
        .filter(order -> order.getStatus() == OrderStatus.CREATED)
        .map(
            order -> {
              order.markPaymentRequested(now());
              return true;
            })
        .orElse(false);
  }

  /**
   * 결제 처리 독점을 잡는다. 같은 주문을 동시에 결제 처리하는 요청이 없고 주문이 CREATED일 때만 true. 독점은 {@link #PAY_LOCK_TTL} 뒤 자동으로
   * 풀려, 처리 중 서버가 죽어도 재시도가 이어받을 수 있다.
   */
  @Transactional
  public boolean tryAcquirePayLock(Long orderId) {
    OffsetDateTime now = now();
    return orderRepository.acquirePayLock(orderId, now, now.plus(PAY_LOCK_TTL)) == 1;
  }

  /** 결제 처리 독점을 놓는다. */
  @Transactional
  public void releasePayLock(Long orderId) {
    orderRepository.releasePayLock(orderId);
  }

  /** 결제 성공 직후 결제 ID를 저장한다(별도 트랜잭션). 확정 전에 실패해도 환불·수동 확인에 쓸 수 있다. */
  @Transactional
  public void recordPaymentId(Long orderId, Long paymentId) {
    orderRepository
        .findWithLockById(orderId)
        .filter(order -> order.getStatus() == OrderStatus.CREATED)
        .ifPresent(order -> order.recordPaymentId(paymentId, now()));
  }

  /** CREATED 상태의 주문만 FAILED로 바꾼다. 이미 확정·종료된 주문은 건드리지 않는다. */
  @Transactional
  public void markFailed(Long orderId, String reason) {
    orderRepository
        .findWithLockById(orderId)
        .filter(order -> order.getStatus() == OrderStatus.CREATED)
        .ifPresent(order -> order.markFailed(reason, now()));
  }

  private String issueOrderNo(LocalDate today) {
    int seq = orderNoRepository.nextSequence(today);
    return "%s-%04d".formatted(today.format(ORDER_NO_DATE), seq);
  }

  private OffsetDateTime now() {
    return OffsetDateTime.now(clock);
  }
}
