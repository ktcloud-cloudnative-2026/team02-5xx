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
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;

/** 주문 저장 단위 트랜잭션. 외부 서비스 호출 동안 DB 트랜잭션을 잡고 있지 않도록 OrderService와 분리했다. */
@Service
public class OrderTxService {

  /** 외부 호출 타임아웃(연결 2초·읽기 3초)으로 환불까지 이어져도 끝나는 시간보다 충분히 길게 잡는다. */
  static final java.time.Duration PAY_LOCK_TTL = java.time.Duration.ofSeconds(60);

  private static final List<OrderStatus> PAY_LOCK_STATUSES = List.of(OrderStatus.CREATED);

  private static final List<OrderStatus> CANCELABLE_CONFIRMED_STATUSES =
      List.of(OrderStatus.PAID, OrderStatus.WAITING, OrderStatus.COOKING);

  private static final List<OrderStatus> CANCEL_LOCK_STATUSES =
      List.of(
          OrderStatus.CREATED,
          OrderStatus.PAID,
          OrderStatus.WAITING,
          OrderStatus.COOKING,
          OrderStatus.CANCELED);

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

  /** 취소 처리에 필요한 값. 외부 호출 전에 읽어 두고 트랜잭션을 닫는다. */
  public record CancelTarget(
      Long id,
      OrderStatus status,
      Long holdId,
      String orderNo,
      Long paymentId,
      OffsetDateTime paymentRequestedAt,
      OffsetDateTime stockRestoredAt,
      OffsetDateTime refundedAt,
      OrderDetailResponse detail) {

    /** 재고 복원이 남았는가: 확정(주문번호 발급)된 뒤 취소됐는데 아직 복원을 못 했다. */
    public boolean stockRestoreRemaining() {
      return status == OrderStatus.CANCELED && orderNo != null && stockRestoredAt == null;
    }

    /** 환불이 남았는가: 결제된 뒤 취소됐는데 아직 환불을 못 했다. */
    public boolean refundRemaining() {
      return status == OrderStatus.CANCELED
          && orderNo != null
          && paymentId != null
          && refundedAt == null;
    }
  }

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
  public CancelTarget findCancelTarget(Long userId, Long orderId) {
    return orderRepository
        .findByIdAndUserId(orderId, userId)
        .map(OrderTxService::toCancelTarget)
        .orElseThrow(() -> new BusinessException(ErrorCode.ORDER_NOT_FOUND));
  }

  /** 후속 처리를 이어서 할 때 쓴다(사용자 확인 없이 ID로 읽는다). */
  @Transactional(readOnly = true)
  public CancelTarget findCancelTargetById(Long orderId) {
    return orderRepository
        .findById(orderId)
        .map(OrderTxService::toCancelTarget)
        .orElseThrow(() -> new BusinessException(ErrorCode.ORDER_NOT_FOUND));
  }

  private static CancelTarget toCancelTarget(Order order) {
    return new CancelTarget(
        order.getId(),
        order.getStatus(),
        order.getHoldId(),
        order.getOrderNo(),
        order.getPaymentId(),
        order.getPaymentRequestedAt(),
        order.getStockRestoredAt(),
        order.getRefundedAt(),
        OrderDetailResponse.from(order));
  }

  /** 취소 후속 처리가 남은 주문 ID(오래된 것부터). 방금 취소돼 아직 처리 중일 수 있는 주문은 {@code graceSec}초 동안 건너뛴다. */
  @Transactional(readOnly = true)
  public List<Long> findCancelFollowUpIds(int graceSec, int limit) {
    OffsetDateTime now = now();
    return orderRepository.findCancelFollowUpIds(
        now.minusSeconds(graceSec), now, PageRequest.of(0, limit));
  }

  /**
   * 주문을 취소 상태로 바꾼다. 내 독점이고 취소할 수 있는 상태일 때만 바꾸며, 이미 CANCELED이면 그대로 두고 true(멱등). 독점을 잃었거나 취소할 수 없는
   * 상태면 false이고 호출자는 이후 단계를 하지 않아야 한다.
   */
  @Transactional
  public boolean markCanceled(Long orderId, UUID lockToken, String reason) {
    return orderRepository
        .findWithLockById(orderId)
        .filter(order -> holds(order, lockToken))
        .filter(
            order ->
                order.getStatus() == OrderStatus.CANCELED
                    || order.getStatus() == OrderStatus.CREATED
                    || (order.getStatus().isConfirmed()
                        && order.getStatus() != OrderStatus.COMPLETED))
        .map(
            order -> {
              order.markCanceled(reason, now());
              return true;
            })
        .orElse(false);
  }

  /**
   * 취소 요청 시각을 기록한다(Cooking 호출 직전). 내 독점이고 확정된 주문(조리 완료 제외)일 때만 기록하며 기록했으면 true. false면 호출자는
   * Cooking을 호출하지 않아야 한다.
   */
  @Transactional
  public boolean markCancelRequested(Long orderId, UUID lockToken) {
    return orderRepository
        .findWithLockById(orderId)
        .filter(order -> holds(order, lockToken) && isCancelableConfirmed(order.getStatus()))
        .map(
            order -> {
              order.markCancelRequested(now());
              return true;
            })
        .orElse(false);
  }

  /** Cooking이 취소를 거절했을 때 취소 요청 기록을 지운다(재확인 대상에서 뺀다). 내 독점일 때만 반영한다. */
  @Transactional
  public void clearCancelRequested(Long orderId, UUID lockToken) {
    orderRepository
        .findWithLockById(orderId)
        .filter(order -> holds(order, lockToken))
        .ifPresent(order -> order.clearCancelRequested(now()));
  }

  /** Cooking 응답을 모른 채 남은 취소 요청의 주문 ID(오래된 것부터). */
  @Transactional(readOnly = true)
  public List<Long> findCancelRequestIds(int graceSec, int limit) {
    OffsetDateTime now = now();
    return orderRepository.findCancelRequestIds(
        CANCELABLE_CONFIRMED_STATUSES, now.minusSeconds(graceSec), now, PageRequest.of(0, limit));
  }

  private static boolean isCancelableConfirmed(OrderStatus status) {
    return CANCELABLE_CONFIRMED_STATUSES.contains(status);
  }

  /**
   * 취소 후속 처리 실패를 기록한다(실패 횟수 증가, 다음 시도 시각 지연, 상한에 닿으면 수동 확인 필요 표시). 내 독점일 때만 반영하며, 이번 실패로 수동 확인 필요가
   * 되었으면 true.
   */
  @Transactional
  public boolean recordCancelFollowUpFailure(
      Long orderId, UUID lockToken, CancelFollowUpPolicy policy) {
    return orderRepository
        .findWithLockById(orderId)
        .filter(order -> order.getStatus() == OrderStatus.CANCELED && holds(order, lockToken))
        .map(
            order ->
                order.recordCancelFollowUpFailure(
                    now(),
                    policy.maxAttempts(),
                    policy.delayAfter(order.getCancelFollowUpAttempts())))
        .orElse(false);
  }

  /** 다시 호출해도 결과가 같은 실패라 바로 수동 확인 필요로 표시한다. 내 독점일 때만 반영하며, 새로 표시했으면 true. */
  @Transactional
  public boolean markCancelFollowUpManual(Long orderId, UUID lockToken, String reason) {
    return orderRepository
        .findWithLockById(orderId)
        .filter(order -> order.getStatus() == OrderStatus.CANCELED && holds(order, lockToken))
        .map(order -> order.markCancelFollowUpManual(reason, now()))
        .orElse(false);
  }

  /** 재고 복원을 끝냈음을 기록한다. 내 독점일 때만 반영하며 반영했으면 true. */
  @Transactional
  public boolean markStockRestored(Long orderId, UUID lockToken) {
    return orderRepository
        .findWithLockById(orderId)
        .filter(order -> order.getStatus() == OrderStatus.CANCELED && holds(order, lockToken))
        .map(
            order -> {
              order.markStockRestored(now());
              return true;
            })
        .orElse(false);
  }

  /** 환불을 끝냈음을 기록한다. 내 독점일 때만 반영하며 반영했으면 true. */
  @Transactional
  public boolean markRefunded(Long orderId, UUID lockToken) {
    return orderRepository
        .findWithLockById(orderId)
        .filter(order -> order.getStatus() == OrderStatus.CANCELED && holds(order, lockToken))
        .map(
            order -> {
              order.markRefunded(now());
              return true;
            })
        .orElse(false);
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
   * 한다. 이미 확정된 주문이면 아무것도 바꾸지 않고 현재 상태를 돌려준다(중복 호출 방지). 결제 처리 독점 토큰이 일치하지 않으면(독점을 잃었으면) 바꾸지 않고
   * {@code ORDER_PAY_IN_PROGRESS}로 끝낸다.
   */
  @Transactional
  public OrderDetailResponse confirmOrder(
      Long orderId, UUID lockToken, Long paymentId, List<ValidatedMenu> menus) {
    Order order =
        orderRepository
            .findWithLockById(orderId)
            .orElseThrow(() -> new BusinessException(ErrorCode.ORDER_NOT_FOUND));
    if (order.getStatus() != OrderStatus.CREATED) {
      return OrderDetailResponse.from(order);
    }
    if (!holds(order, lockToken)) {
      throw new BusinessException(ErrorCode.ORDER_PAY_IN_PROGRESS);
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
   * CREATED가 아니거나 독점을 잃었으면 기록하지 않고 false를 돌려주며, 호출자는 결제를 요청하지 않아야 한다.
   */
  @Transactional
  public boolean markPaymentRequested(Long orderId, UUID lockToken) {
    return orderRepository
        .findWithLockById(orderId)
        .filter(order -> order.getStatus() == OrderStatus.CREATED && holds(order, lockToken))
        .map(
            order -> {
              order.markPaymentRequested(now());
              return true;
            })
        .orElse(false);
  }

  /**
   * 결제 처리 독점을 잡는다. 같은 주문을 동시에 결제 처리하는 요청이 없고 주문이 CREATED일 때만 토큰을 돌려준다. 독점은 {@link #PAY_LOCK_TTL} 뒤
   * 자동으로 풀려, 처리 중 서버가 죽어도 재시도가 이어받을 수 있다. 이어받을 때마다 토큰이 바뀐다.
   */
  @Transactional
  public Optional<UUID> tryAcquirePayLock(Long orderId) {
    return acquire(orderId, PAY_LOCK_STATUSES);
  }

  /**
   * 취소 처리 독점을 잡는다. 결제와 같은 독점이라 결제·취소·후속 처리가 한 주문에서 동시에 돌지 않는다. 취소할 수 있는 상태(CREATED·확정된 주문)와, 후속 처리를
   * 이어서 해야 하는 CANCELED 주문에서 잡을 수 있다.
   */
  @Transactional
  public Optional<UUID> tryAcquireCancelLock(Long orderId) {
    return acquire(orderId, CANCEL_LOCK_STATUSES);
  }

  private Optional<UUID> acquire(Long orderId, List<OrderStatus> statuses) {
    OffsetDateTime now = now();
    UUID token = UUID.randomUUID();
    return orderRepository.acquirePayLock(orderId, now, now.plus(PAY_LOCK_TTL), token, statuses)
            == 1
        ? Optional.of(token)
        : Optional.empty();
  }

  /**
   * 외부 호출(결제·환불·재고 확정)을 하기 전에 호출한다. 토큰이 아직 내 것이면 만료를 늦추고 true, 이미 다른 요청이 이어받았거나 주문이 종료됐으면 false다.
   * false면 호출자는 아무것도 하지 않고 멈춰야 한다.
   */
  @Transactional
  public boolean renewPayLock(Long orderId, UUID lockToken) {
    return orderRepository.renewPayLock(orderId, now().plus(PAY_LOCK_TTL), lockToken) == 1;
  }

  /** 내 독점만 놓는다. 만료 후 다른 요청이 이어받은 독점은 건드리지 않는다. */
  @Transactional
  public void releasePayLock(Long orderId, UUID lockToken) {
    orderRepository.releasePayLock(orderId, lockToken);
  }

  /** 결제 성공 직후 결제 ID를 저장한다(별도 트랜잭션). 확정 전에 실패해도 환불·수동 확인에 쓸 수 있다. 독점을 잃었으면 저장하지 않는다. */
  @Transactional
  public void recordPaymentId(Long orderId, UUID lockToken, Long paymentId) {
    orderRepository
        .findWithLockById(orderId)
        .filter(order -> order.getStatus() == OrderStatus.CREATED && holds(order, lockToken))
        .ifPresent(order -> order.recordPaymentId(paymentId, now()));
  }

  /**
   * 결제 흐름에서 주문을 종료한다. CREATED이고 내 독점일 때만 FAILED로 바꾸며, 바꿨으면 true. 독점을 잃었으면 false이고 호출자는 재고 반환 등 후속
   * 처리를 하지 않아야 한다.
   */
  @Transactional
  public boolean markFailed(Long orderId, UUID lockToken, String reason) {
    return orderRepository
        .findWithLockById(orderId)
        .filter(order -> order.getStatus() == OrderStatus.CREATED && holds(order, lockToken))
        .map(
            order -> {
              order.markFailed(reason, now());
              return true;
            })
        .orElse(false);
  }

  private static boolean holds(Order order, UUID lockToken) {
    return lockToken != null && lockToken.equals(order.getPayLockToken());
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
