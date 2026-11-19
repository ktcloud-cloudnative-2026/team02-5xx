package com.peakorder.order.service;

import com.peakorder.order.client.CookingClient;
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
import com.peakorder.order.dto.OrderDetailResponse.CookingInfo;
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
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class OrderService {

  /** Cooking cooking_ticket_items.option_summary 컬럼 길이. */
  private static final int COOKING_OPTION_SUMMARY_MAX = 255;

  private static final Logger log = LoggerFactory.getLogger(OrderService.class);

  /** 고객 주문 목록에서 제외하는 상태 (확정되지 않은 주문). */
  /** 결제가 확정된 주문. 이 상태일 때만 Cooking 조리 상태를 조회한다. */
  private static final Set<OrderStatus> COOKING_LOOKUP_STATUSES =
      Set.of(OrderStatus.PAID, OrderStatus.WAITING, OrderStatus.COOKING, OrderStatus.COMPLETED);

  private static final List<OrderStatus> HIDDEN_FROM_LIST =
      List.of(OrderStatus.CREATED, OrderStatus.FAILED);

  private static final int MAX_PAGE_SIZE = 100;

  private final OrderRepository orderRepository;
  private final StoreOperationRepository storeOperationRepository;
  private final OrderTxService txService;
  private final MenuClient menuClient;
  private final InventoryClient inventoryClient;
  private final PaymentClient paymentClient;
  private final CookingAvailability cookingAvailability;
  private final CookingClient cookingClient;
  private final Clock clock;

  public OrderService(
      OrderRepository orderRepository,
      StoreOperationRepository storeOperationRepository,
      OrderTxService txService,
      MenuClient menuClient,
      InventoryClient inventoryClient,
      PaymentClient paymentClient,
      CookingAvailability cookingAvailability,
      CookingClient cookingClient,
      Clock clock) {
    this.orderRepository = orderRepository;
    this.storeOperationRepository = storeOperationRepository;
    this.txService = txService;
    this.menuClient = menuClient;
    this.inventoryClient = inventoryClient;
    this.paymentClient = paymentClient;
    this.cookingAvailability = cookingAvailability;
    this.cookingClient = cookingClient;
    this.clock = clock;
  }

  /** OR-01 임시 주문 생성: 접수 확인 → Menu 검증 → 임시 주문 저장 → Inventory 재고 확보. */
  public OrderDetailResponse createOrder(Long userId, CreateOrderRequest request) {
    ensureAcceptingOrders();
    // Cooking 장애 시 신규 주문 생성을 막는다(US-13). 매장 접수 설정과는 별개다.
    cookingAvailability.ensureAvailable();

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
    ensureCookingCanRegister(priced);

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
    try {
      return txService.markHeld(orderId, hold);
    } catch (RuntimeException e) {
      compensateHoldSaveFailure(orderId, hold);
      throw e;
    }
  }

  /**
   * 결제가 끝난 뒤 Cooking이 조리 전표를 만들지 못하는 주문을 미리 거른다. Cooking은 옵션 이름을 ", "로 이어붙여 255자
   * 컬럼(option_summary)에 저장하므로, 그보다 길어지면 결제·확정 뒤에 Cooking이 저장에 실패해 돈만 받고 조리가 안 되는 주문이 생긴다. 결제 전(주문
   * 생성 단계)에 거절한다.
   */
  private static void ensureCookingCanRegister(List<PricedLine> priced) {
    for (PricedLine line : priced) {
      int length =
          line.options().stream().mapToInt(o -> o.getOptionName().length()).sum()
              + 2 * Math.max(line.options().size() - 1, 0);
      if (length > COOKING_OPTION_SUMMARY_MAX) {
        throw new BusinessException(ErrorCode.INVALID_REQUEST);
      }
    }
  }

  /**
   * 재고는 확보됐는데 확보 ID를 주문에 저장하지 못했을 때의 보상 처리. 확보가 만료(기본 5분)될 때까지 재고가 묶이지 않도록 해제를 시도하고, 주문을 실패로 끝낸다.
   * 보상도 실패하면 Inventory의 만료 처리에 맡기고 원래 오류를 그대로 돌려준다.
   */
  private void compensateHoldSaveFailure(Long orderId, StockHold hold) {
    releaseQuietly(hold.holdId());
    try {
      txService.markFailed(orderId, "HOLD_SAVE_FAILED");
    } catch (RuntimeException e) {
      log.warn("확보 저장 실패 후 주문 실패 처리도 실패 orderId={}", orderId, e);
    }
  }

  /**
   * OR-02 모의 결제 요청 및 주문 확정: 결제(PI-01) → 재고 확정(II-02) → 주문 확정(PAID, 주문번호, OrderConfirmed outbox).
   *
   * <p>같은 주문에 반복 호출해도 안전하다. 결제는 idempotencyKey로, 재고 확정은 Inventory가, 주문 확정은 행 잠금과 상태 확인으로 중복을 막는다.
   * 결제·재고 확정 결과를 알 수 없을 때는 주문을 그대로 두고 503을 돌려주며, 같은 주문으로 다시 호출하면 이어서 처리된다.
   *
   * <p>결제를 한 번이라도 요청했다면(요청 직전에 {@code payment_requested_at}을 기록한다) 결제가 이미 됐을 수 있다. 이 경우에는 재고 확보가
   * 만료됐거나 그 사이 메뉴 판매가 중지됐어도 결제 결과를 확인하기 전에 주문을 종료하지 않는다. 같은 키로 결제 결과를 확인하고(PI-01은 같은 키에 처음 결과를
   * 돌려준다), 성공했는데 확정할 수 없으면 환불하며, 환불까지 실패하면 {@code *_REFUND_NEEDED}로 남겨 수동 확인한다.
   */
  public OrderDetailResponse payOrder(Long userId, Long orderId) {
    PaymentTarget first = txService.findPaymentTarget(userId, orderId);
    if (first.status().isConfirmed()) {
      return first.detail();
    }
    if (first.status() != OrderStatus.CREATED || first.holdId() == null) {
      throw new BusinessException(ErrorCode.ORDER_NOT_PAYABLE);
    }

    // 같은 주문을 동시에 결제 처리하면 한쪽은 확정하고 다른 쪽은 환불·종료하는 모순이 생길 수 있다.
    // 한 요청만 처리 독점을 잡고, 나머지는 기다리지 않고 현재 상태로 응답한다.
    Optional<UUID> acquired = txService.tryAcquirePayLock(orderId);
    if (acquired.isEmpty()) {
      return answerWithoutPaying(userId, orderId);
    }
    UUID lock = acquired.get();
    try {
      // 독점을 잡기 전에 읽은 값은 오래됐을 수 있으므로 독점을 잡은 뒤 다시 읽는다.
      PaymentTarget target = txService.findPaymentTarget(userId, orderId);
      if (target.status().isConfirmed()) {
        return target.detail();
      }
      if (target.status() != OrderStatus.CREATED || target.holdId() == null) {
        throw new BusinessException(ErrorCode.ORDER_NOT_PAYABLE);
      }
      return pay(orderId, lock, target);
    } finally {
      releasePayLockQuietly(orderId, lock);
    }
  }

  /** 다른 요청이 결제를 처리 중이거나 이미 끝난 경우의 응답. 결제는 호출하지 않는다. */
  private OrderDetailResponse answerWithoutPaying(Long userId, Long orderId) {
    PaymentTarget current = txService.findPaymentTarget(userId, orderId);
    if (current.status().isConfirmed()) {
      return current.detail();
    }
    if (current.status() != OrderStatus.CREATED) {
      throw new BusinessException(ErrorCode.ORDER_NOT_PAYABLE);
    }
    throw new BusinessException(ErrorCode.ORDER_PAY_IN_PROGRESS);
  }

  /** 처리 독점을 잡은 요청만 호출한다. {@code lock}은 그 독점의 토큰이다. */
  private OrderDetailResponse pay(Long orderId, UUID lock, PaymentTarget target) {
    // 결제를 이미 요청한 적이 있으면 결제가 됐을 수 있다(응답을 받지 못했을 뿐일 수 있다).
    boolean paymentMayExist = target.paymentRequestedAt() != null;
    boolean holdExpired =
        target.holdExpiresAt() == null
            || !target.holdExpiresAt().isAfter(OffsetDateTime.now(clock));
    if (holdExpired && !paymentMayExist) {
      // 결제한 적이 없으므로 돈이 나가지 않았다. 바로 종료한다.
      failOrder(orderId, lock, "HOLD_EXPIRED");
      throw new BusinessException(ErrorCode.HOLD_EXPIRED);
    }
    // Cooking 장애 시 새 결제를 막는다(US-13). 주문은 CREATED로 그대로 두고 이미 확정된 주문은 건드리지 않는다.
    // 결제를 이미 요청한 적이 있는 주문은 같은 키로 기존 결과를 확인하는 것이라 새로 결제되지 않는다. 결제가 됐을 수 있는데
    // 사용자가 "결제할 수 없음"만 보지 않도록 막지 않고 결과 확인·복구(환불·확정)를 이어서 한다(PR #56 Payment 리뷰).
    if (!paymentMayExist) {
      cookingAvailability.ensureAvailable();
    }

    // 결제 전에 Menu에서 조리 시간을 받아 둔다. 결제한 적이 없다면 여기서 실패해도 돈이 나가지 않는다.
    List<ValidatedMenu> menus = fetchCookTimes(orderId, lock, target, paymentMayExist);

    // 결제 요청 직전에 기록한다. 기록에 실패하면 예외가 나 결제는 요청되지 않는다.
    // 주문 상태가 바뀌었거나 독점을 잃었으면 false라서 결제를 요청하지 않는다.
    if (!txService.markPaymentRequested(orderId, lock)) {
      throw new BusinessException(ErrorCode.ORDER_PAY_IN_PROGRESS);
    }
    PaymentResult payment =
        paymentClient.pay(orderId, target.totalAmount(), idempotencyKey(orderId));
    if (!payment.isSuccess()) {
      // REFUNDED: 이전 시도에서 환불까지 끝났는데 주문 종료 저장만 실패한 경우. 돈은 이미 돌아갔으므로 종료한다.
      if (failOrder(orderId, lock, payment.isRefunded() ? "PAYMENT_REFUNDED" : "PAYMENT_FAILED")) {
        releaseQuietly(target.holdId());
      }
      throw new BusinessException(ErrorCode.PAYMENT_FAILED);
    }
    recordPaymentIdQuietly(orderId, lock, payment.paymentId());

    // 결제는 시간이 걸릴 수 있으므로, 재고를 확정하기 전에 아직 내 독점인지 확인하고 만료를 늦춘다.
    keepLockOrStop(orderId, lock);
    try {
      inventoryClient.confirm(target.holdId());
    } catch (BusinessException e) {
      if (e.errorCode() == ErrorCode.STOCK_CONFIRM_FAILED) {
        // 결제는 성공했지만 재고를 확정할 수 없음이 확실하므로 결제를 취소하고 주문을 종료한다.
        keepLockOrStop(orderId, lock);
        boolean refunded = refundQuietly(payment.paymentId());
        failOrder(
            orderId,
            lock,
            refunded ? "STOCK_CONFIRM_FAILED" : "STOCK_CONFIRM_FAILED_REFUND_NEEDED");
      }
      throw e;
    }
    return txService.confirmOrder(orderId, lock, payment.paymentId(), menus);
  }

  /**
   * 외부 호출을 하기 전에 아직 내 독점인지 확인한다. 이미 다른 요청이 이어받았다면 결제·환불·확정 중 어느 것도 하지 않고 멈춘다(이어받은 요청이 같은 멱등키로 결과를
   * 이어서 처리한다).
   */
  private void keepLockOrStop(Long orderId, UUID lock) {
    if (!txService.renewPayLock(orderId, lock)) {
      throw new BusinessException(ErrorCode.ORDER_PAY_IN_PROGRESS);
    }
  }

  /** 내 독점일 때만 주문을 종료한다. 독점을 잃었으면 종료하지 않고 false(후속 처리도 하지 않는다). */
  private boolean failOrder(Long orderId, UUID lock, String reason) {
    return txService.markFailed(orderId, lock, reason);
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

  /**
   * OR-04 본인 주문 상세. 다른 사용자의 주문은 존재 여부를 숨기기 위해 404로 응답한다. 결제된 주문에는 Cooking 조리 상태(CI-02)를 덧붙인다. 주문은
   * 트랜잭션 안에서 읽고 닫은 뒤 Cooking을 호출하며, Cooking을 알 수 없어도 상세 조회는 성공한다(주문 상태는 바꾸지 않는다).
   */
  public OrderDetailResponse getOrder(Long userId, Long orderId) {
    OrderDetailResponse detail =
        txService
            .findDetail(userId, orderId)
            .orElseThrow(() -> new BusinessException(ErrorCode.ORDER_NOT_FOUND));
    if (!COOKING_LOOKUP_STATUSES.contains(detail.status())) {
      return detail;
    }
    return detail.withCooking(lookupCooking(orderId));
  }

  private CookingInfo lookupCooking(Long orderId) {
    try {
      return cookingClient
          .getStatus(orderId)
          .map(
              s ->
                  CookingInfo.ok(
                      s.status(),
                      s.waitingAhead(),
                      s.estimatedCookSec(),
                      s.expectedWaitSec(),
                      s.expectedReadySec(),
                      s.startedAt()))
          .orElseGet(CookingInfo::pending);
    } catch (BusinessException e) {
      log.warn("주문 상세의 조리 상태를 알 수 없음 orderId={} reason={}", orderId, e.errorCode());
      return CookingInfo.unavailable();
    }
  }

  /**
   * 결제 직전 Menu 재조회(MI-01). 주문 항목과 같은 순서의 조리 시간을 돌려준다. 그 사이 판매가 중지된 메뉴가 있으면 주문을 종료하고 재고를 반환한다. 다만
   * 결제를 이미 요청한 적이 있다면(결제가 됐을 수 있다) 결제 결과를 확인해 성공이면 환불한 뒤 종료한다. Menu에 연결할 수 없으면 주문을 그대로 두고 오류만 돌려준다.
   */
  private List<ValidatedMenu> fetchCookTimes(
      Long orderId, UUID lock, PaymentTarget target, boolean paymentMayExist) {
    List<ValidatedMenu> menus;
    try {
      menus = menuClient.validatePurchase(target.lines());
    } catch (BusinessException e) {
      if (e.errorCode() == ErrorCode.MENU_NOT_AVAILABLE) {
        if (paymentMayExist) {
          endAfterPossiblePayment(orderId, lock, target, "MENU_NOT_AVAILABLE");
        } else if (failOrder(orderId, lock, "MENU_NOT_AVAILABLE")) {
          releaseQuietly(target.holdId());
        }
      }
      throw e;
    }
    if (menus == null || menus.size() != target.lines().size()) {
      throw new BusinessException(ErrorCode.UPSTREAM_INVALID_RESPONSE);
    }
    for (int i = 0; i < menus.size(); i++) {
      PurchaseLine line = target.lines().get(i);
      ValidatedMenu menu = menus.get(i);
      if (menu == null
          || !line.menuId().equals(menu.menuId())
          || menu.cookTimeSec() == null
          || menu.cookTimeSec() < 0
          || !hasExactOptions(line, menu)) {
        throw new BusinessException(ErrorCode.UPSTREAM_INVALID_RESPONSE);
      }
    }
    return menus;
  }

  /**
   * 결제가 이미 됐을 수 있는 주문을 종료한다. 같은 키로 결제 결과를 확인하고(처음 결과를 돌려준다), 성공이면 환불한다. 환불까지 실패하면 수동 확인 대상으로 남긴다.
   * 결제 결과를 알 수 없으면(예외) 주문을 그대로 두므로 같은 주문으로 다시 호출할 수 있다.
   */
  private void endAfterPossiblePayment(
      Long orderId, UUID lock, PaymentTarget target, String reason) {
    keepLockOrStop(orderId, lock);
    PaymentResult payment =
        paymentClient.pay(orderId, target.totalAmount(), idempotencyKey(orderId));
    String failReason = reason;
    if (payment.isSuccess()) {
      recordPaymentIdQuietly(orderId, lock, payment.paymentId());
      keepLockOrStop(orderId, lock);
      if (!refundQuietly(payment.paymentId())) {
        failReason = reason + "_REFUND_NEEDED";
      }
    }
    if (failOrder(orderId, lock, failReason)) {
      releaseQuietly(target.holdId());
    }
  }

  private void releasePayLockQuietly(Long orderId, UUID lock) {
    try {
      txService.releasePayLock(orderId, lock);
    } catch (RuntimeException e) {
      // 놓지 못해도 만료 시각이 지나면 풀린다.
      log.warn("결제 처리 독점을 놓지 못했습니다. 만료되면 풀립니다. orderId={}", orderId, e);
    }
  }

  private void recordPaymentIdQuietly(Long orderId, UUID lock, Long paymentId) {
    try {
      txService.recordPaymentId(orderId, lock, paymentId);
    } catch (RuntimeException e) {
      // 확정 단계에서도 저장하므로 여기서 실패해도 흐름은 계속한다. 로그로 남겨 수동 복구에 쓴다.
      log.error("결제 ID 저장 실패, 수동 확인 필요 orderId={} paymentId={}", orderId, paymentId, e);
    }
  }

  private static boolean hasExactOptions(PurchaseLine line, ValidatedMenu menu) {
    List<ValidatedOption> options = menu.options() == null ? List.of() : menu.options();
    Set<Long> returned = new HashSet<>();
    for (ValidatedOption o : options) {
      if (o == null
          || o.optionId() == null
          || o.extraCookTimeSec() == null
          || o.extraCookTimeSec() < 0) {
        return false;
      }
      returned.add(o.optionId());
    }
    return returned.equals(new HashSet<>(line.optionIds())) && returned.size() == options.size();
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
