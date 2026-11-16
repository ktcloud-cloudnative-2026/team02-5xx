package com.peakorder.order.service;

import com.peakorder.order.client.InventoryClient;
import com.peakorder.order.client.InventoryClient.HoldLine;
import com.peakorder.order.client.InventoryClient.StockHold;
import com.peakorder.order.client.MenuClient;
import com.peakorder.order.client.MenuClient.PurchaseLine;
import com.peakorder.order.client.MenuClient.ValidatedMenu;
import com.peakorder.order.client.MenuClient.ValidatedOption;
import com.peakorder.order.client.PaymentClient;
import com.peakorder.order.client.PaymentClient.PaymentResult;
import com.peakorder.order.dto.CreateOrderRequest;
import com.peakorder.order.dto.CreateOrderRequest.OrderLine;
import com.peakorder.order.dto.OrderDetailResponse;
import com.peakorder.order.dto.OrderListResponse;
import com.peakorder.order.dto.OrderSummaryResponse;
import com.peakorder.order.entity.Order;
import com.peakorder.order.entity.OrderItemOption;
import com.peakorder.order.entity.OrderStatus;
import com.peakorder.order.entity.StoreOperation;
import com.peakorder.order.exception.BusinessException;
import com.peakorder.order.exception.ErrorCode;
import com.peakorder.order.repository.OrderRepository;
import com.peakorder.order.repository.StoreOperationRepository;
import com.peakorder.order.service.OrderTxService.PaymentTarget;
import com.peakorder.order.service.OrderTxService.PricedLine;
import java.time.Clock;
import java.time.OffsetDateTime;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class OrderService {

  private static final Logger log = LoggerFactory.getLogger(OrderService.class);

  /** 고객 주문 목록에서 제외하는 상태 (확정되지 않은 주문). */
  private static final List<OrderStatus> HIDDEN_FROM_LIST =
      List.of(OrderStatus.CREATED, OrderStatus.FAILED);

  private static final int MAX_PAGE_SIZE = 100;

  private final OrderRepository orderRepository;
  private final StoreOperationRepository storeOperationRepository;
  private final OrderTxService txService;
  private final MenuClient menuClient;
  private final InventoryClient inventoryClient;
  private final PaymentClient paymentClient;
  private final Clock clock;

  public OrderService(
      OrderRepository orderRepository,
      StoreOperationRepository storeOperationRepository,
      OrderTxService txService,
      MenuClient menuClient,
      InventoryClient inventoryClient,
      PaymentClient paymentClient,
      Clock clock) {
    this.orderRepository = orderRepository;
    this.storeOperationRepository = storeOperationRepository;
    this.txService = txService;
    this.menuClient = menuClient;
    this.inventoryClient = inventoryClient;
    this.paymentClient = paymentClient;
    this.clock = clock;
  }

  /** OR-01 임시 주문 생성: 접수 확인 → Menu 검증 → 임시 주문 저장 → Inventory 재고 확보. */
  public OrderDetailResponse createOrder(Long userId, CreateOrderRequest request) {
    ensureAcceptingOrders();

    List<OrderLine> lines = request.items();
    List<ValidatedMenu> validated =
        menuClient.validatePurchase(
            lines.stream()
                .map(
                    l ->
                        new PurchaseLine(
                            l.menuId(),
                            l.quantity(),
                            l.optionIdsOrEmpty().stream().distinct().toList()))
                .toList());
    List<PricedLine> priced = toPricedLines(lines, validated);

    Long orderId;
    try {
      orderId = txService.createTemporaryOrder(userId, priced);
    } catch (ArithmeticException e) {
      throw new BusinessException(ErrorCode.INVALID_REQUEST);
    }

    StockHold hold;
    try {
      hold = inventoryClient.hold(orderId, toHoldLines(priced));
    } catch (RuntimeException e) {
      String reason = e instanceof BusinessException be ? be.errorCode().name() : "INVENTORY_ERROR";
      txService.markFailed(orderId, reason);
      throw e;
    }
    return txService.markHeld(orderId, hold);
  }

  /**
   * OR-02 모의 결제 요청 및 주문 확정: 결제(PI-01) → 재고 확정(II-02) → 주문 확정(PAID, 주문번호, OrderConfirmed outbox).
   *
   * <p>같은 주문에 반복 호출해도 안전하다. 결제는 idempotencyKey로, 재고 확정은 Inventory가, 주문 확정은 행 잠금과 상태 확인으로 중복을 막는다.
   * 결제·재고 확정 결과를 알 수 없을 때는 주문을 그대로 두고 503을 돌려주며, 같은 주문으로 다시 호출하면 이어서 처리된다.
   */
  public OrderDetailResponse payOrder(Long userId, Long orderId) {
    PaymentTarget target = txService.findPaymentTarget(userId, orderId);

    if (target.status().isConfirmed()) {
      return target.detail();
    }
    if (target.status() != OrderStatus.CREATED || target.holdId() == null) {
      throw new BusinessException(ErrorCode.ORDER_NOT_PAYABLE);
    }
    if (target.holdExpiresAt() == null
        || !target.holdExpiresAt().isAfter(OffsetDateTime.now(clock))) {
      txService.markFailed(orderId, "HOLD_EXPIRED");
      throw new BusinessException(ErrorCode.HOLD_EXPIRED);
    }

    PaymentResult payment =
        paymentClient.pay(orderId, target.totalAmount(), idempotencyKey(orderId));
    if (!payment.isSuccess()) {
      txService.markFailed(orderId, "PAYMENT_FAILED");
      releaseQuietly(target.holdId());
      throw new BusinessException(ErrorCode.PAYMENT_FAILED);
    }

    try {
      inventoryClient.confirm(target.holdId());
    } catch (BusinessException e) {
      if (e.errorCode() == ErrorCode.STOCK_CONFIRM_FAILED) {
        // 결제는 성공했지만 재고를 확정할 수 없음이 확실하므로 결제를 취소하고 주문을 종료한다.
        boolean refunded = refundQuietly(payment.paymentId());
        txService.markFailed(
            orderId, refunded ? "STOCK_CONFIRM_FAILED" : "STOCK_CONFIRM_FAILED_REFUND_NEEDED");
      }
      throw e;
    }
    return txService.confirmOrder(orderId, payment.paymentId());
  }

  /** OR-03 본인 주문 목록. 확정되지 않은 주문(CREATED, FAILED)은 제외한다. */
  @Transactional(readOnly = true)
  public OrderListResponse listOrders(Long userId, int page, int size) {
    int safePage = Math.max(page, 0);
    int safeSize = Math.min(Math.max(size, 1), MAX_PAGE_SIZE);
    Page<Order> result =
        orderRepository.findByUserIdAndStatusNotIn(
            userId,
            HIDDEN_FROM_LIST,
            PageRequest.of(safePage, safeSize, Sort.by(Sort.Direction.DESC, "orderedAt", "id")));
    return new OrderListResponse(
        result.getContent().stream().map(OrderSummaryResponse::from).toList(),
        safePage,
        safeSize,
        result.getTotalElements());
  }

  /** OR-04 본인 주문 상세. 다른 사용자의 주문은 존재 여부를 숨기기 위해 404로 응답한다. */
  @Transactional(readOnly = true)
  public OrderDetailResponse getOrder(Long userId, Long orderId) {
    return orderRepository
        .findByIdAndUserId(orderId, userId)
        .map(OrderDetailResponse::from)
        .orElseThrow(() -> new BusinessException(ErrorCode.ORDER_NOT_FOUND));
  }

  private static String idempotencyKey(Long orderId) {
    return "order-" + orderId;
  }

  private void releaseQuietly(Long holdId) {
    try {
      inventoryClient.release(holdId);
    } catch (RuntimeException e) {
      log.warn("재고 확보 해제 실패(만료로 해제됨) holdId={}", holdId, e);
    }
  }

  private boolean refundQuietly(Long paymentId) {
    try {
      paymentClient.refund(paymentId);
      return true;
    } catch (RuntimeException e) {
      log.error("결제 취소 실패, 수동 확인 필요 paymentId={}", paymentId, e);
      return false;
    }
  }

  private void ensureAcceptingOrders() {
    boolean accepting =
        storeOperationRepository
            .findById(StoreOperation.SINGLE_STORE_ID)
            .map(StoreOperation::canAcceptOrders)
            .orElse(false);
    if (!accepting) {
      throw new BusinessException(ErrorCode.STORE_NOT_ACCEPTING_ORDERS);
    }
  }

  /** Menu 응답을 요청과 대조해 검증하고, 가격은 항상 Menu 응답 기준으로 사용한다. */
  private List<PricedLine> toPricedLines(List<OrderLine> lines, List<ValidatedMenu> validated) {
    if (validated == null || validated.size() != lines.size()) {
      throw new BusinessException(ErrorCode.UPSTREAM_INVALID_RESPONSE);
    }
    return java.util.stream.IntStream.range(0, lines.size())
        .mapToObj(i -> toPricedLine(lines.get(i), validated.get(i)))
        .toList();
  }

  private PricedLine toPricedLine(OrderLine line, ValidatedMenu menu) {
    if (menu == null
        || !line.menuId().equals(menu.menuId())
        || menu.menuName() == null
        || menu.unitPrice() < 0) {
      throw new BusinessException(ErrorCode.UPSTREAM_INVALID_RESPONSE);
    }
    List<ValidatedOption> options = menu.options() == null ? List.of() : menu.options();
    Set<Long> requested = new HashSet<>(line.optionIdsOrEmpty());
    Set<Long> returned = new HashSet<>();
    List<OrderItemOption> itemOptions =
        options.stream()
            .peek(
                o -> {
                  if (o == null
                      || o.optionId() == null
                      || o.optionName() == null
                      || o.extraPrice() < 0) {
                    throw new BusinessException(ErrorCode.UPSTREAM_INVALID_RESPONSE);
                  }
                  returned.add(o.optionId());
                })
            .map(o -> new OrderItemOption(o.optionId(), o.optionName(), o.extraPrice()))
            .toList();
    if (!requested.equals(returned) || returned.size() != options.size()) {
      throw new BusinessException(ErrorCode.UPSTREAM_INVALID_RESPONSE);
    }
    return new PricedLine(
        menu.menuId(), menu.menuName(), menu.unitPrice(), line.quantity(), itemOptions);
  }

  private List<HoldLine> toHoldLines(List<PricedLine> priced) {
    Map<Long, Integer> byMenu = new LinkedHashMap<>();
    for (PricedLine line : priced) {
      byMenu.merge(line.menuId(), line.quantity(), Integer::sum);
    }
    return byMenu.entrySet().stream().map(e -> new HoldLine(e.getKey(), e.getValue())).toList();
  }
}
