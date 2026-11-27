package com.peakorder.order.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
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
import com.peakorder.order.dto.OrderListResponse;
import com.peakorder.order.entity.Order;
import com.peakorder.order.entity.OrderStatus;
import com.peakorder.order.entity.StoreOperation;
import com.peakorder.order.exception.BusinessException;
import com.peakorder.order.exception.ErrorCode;
import com.peakorder.order.repository.OrderRepository;
import com.peakorder.order.repository.StoreOperationRepository;
import com.peakorder.order.service.OrderTxService.PaymentTarget;
import java.time.Clock;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;

class OrderServiceTest {

  private static final java.util.UUID LOCK =
      java.util.UUID.fromString("00000000-0000-0000-0000-000000000042");
  private final OffsetDateTime now = OffsetDateTime.parse("2026-11-13T10:00:00+09:00");

  private OrderRepository orderRepository;
  private StoreOperationRepository storeRepository;
  private OrderTxService txService;
  private MenuClient menuClient;
  private InventoryClient inventoryClient;
  private PaymentClient paymentClient;
  private CookingAvailability cookingAvailability;
  private CookingClient cookingClient;
  private OrderService service;

  @BeforeEach
  void setUp() {
    orderRepository = mock(OrderRepository.class);
    storeRepository = mock(StoreOperationRepository.class);
    txService = mock(OrderTxService.class);
    menuClient = mock(MenuClient.class);
    inventoryClient = mock(InventoryClient.class);
    paymentClient = mock(PaymentClient.class);
    cookingAvailability = mock(CookingAvailability.class);
    cookingClient = mock(CookingClient.class);
    service =
        new OrderService(
            orderRepository,
            storeRepository,
            txService,
            menuClient,
            inventoryClient,
            paymentClient,
            cookingAvailability,
            cookingClient,
            Clock.fixed(now.toInstant(), ZoneId.of("Asia/Seoul")));
    when(storeRepository.findById(StoreOperation.SINGLE_STORE_ID))
        .thenReturn(Optional.of(new StoreOperation(true, true, now)));
    when(menuClient.validatePurchase(payLines())).thenReturn(cookedMenus());
    when(txService.tryAcquirePayLock(any())).thenReturn(Optional.of(LOCK));
    when(txService.markPaymentRequested(any(), any())).thenReturn(true);
    when(txService.markFailed(any(), any(), any())).thenReturn(true);
    when(txService.renewPayLock(any(), any())).thenReturn(true);
  }

  private List<PurchaseLine> payLines() {
    return List.of(new PurchaseLine(1L, 2, List.of(10L)));
  }

  private List<ValidatedMenu> cookedMenus() {
    return List.of(
        new ValidatedMenu(
            1L, "아메리카노", 3000, 120, List.of(new ValidatedOption(10L, "샷 추가", 500, 30))));
  }

  private CreateOrderRequest request() {
    return new CreateOrderRequest(List.of(new OrderLine(1L, 2, List.of(10L))));
  }

  private List<ValidatedMenu> menuResponse() {
    return List.of(
        new ValidatedMenu(1L, "아메리카노", 3000, List.of(new ValidatedOption(10L, "샷 추가", 500))));
  }

  @Test
  void create_rejects_when_store_is_closed_without_calling_other_services() {
    when(storeRepository.findById(StoreOperation.SINGLE_STORE_ID))
        .thenReturn(Optional.of(new StoreOperation(true, false, now)));

    assertThatThrownBy(() -> service.createOrder(7L, request()))
        .isInstanceOfSatisfying(
            BusinessException.class,
            e -> assertThat(e.errorCode()).isEqualTo(ErrorCode.STORE_NOT_ACCEPTING_ORDERS));
    verify(menuClient, never()).validatePurchase(any());
  }

  @Test
  void create_rejects_when_store_row_is_missing() {
    when(storeRepository.findById(StoreOperation.SINGLE_STORE_ID)).thenReturn(Optional.empty());

    assertThatThrownBy(() -> service.createOrder(7L, request()))
        .isInstanceOf(BusinessException.class);
  }

  @Test
  void create_rejects_options_that_cooking_could_not_store_before_anything_is_saved() {
    // Cooking은 옵션 이름을 ", "로 이어붙여 255자 컬럼에 저장한다. 결제 뒤에 실패하지 않도록 주문 생성에서 거절한다.
    String longName = "가".repeat(100);
    when(menuClient.validatePurchase(any()))
        .thenReturn(
            List.of(
                new ValidatedMenu(
                    1L,
                    "아메리카노",
                    3000,
                    List.of(
                        new ValidatedOption(10L, longName, 500),
                        new ValidatedOption(11L, longName, 500),
                        new ValidatedOption(12L, longName, 500)))));

    assertThatThrownBy(
            () ->
                service.createOrder(
                    7L,
                    new CreateOrderRequest(List.of(new OrderLine(1L, 1, List.of(10L, 11L, 12L))))))
        .isInstanceOfSatisfying(
            BusinessException.class,
            e -> assertThat(e.errorCode()).isEqualTo(ErrorCode.INVALID_REQUEST));

    verify(txService, never()).createTemporaryOrder(any(), any());
    verify(inventoryClient, never()).hold(any(), any());
  }

  @Test
  void menu_failure_leaves_no_order_and_does_not_touch_inventory() {
    when(menuClient.validatePurchase(any()))
        .thenThrow(new BusinessException(ErrorCode.MENU_NOT_AVAILABLE));

    assertThatThrownBy(() -> service.createOrder(7L, request()))
        .isInstanceOf(BusinessException.class);
    verify(txService, never()).createTemporaryOrder(any(), any());
    verify(inventoryClient, never()).hold(any(), any());
  }

  @Test
  void menu_response_that_does_not_match_request_is_rejected() {
    when(menuClient.validatePurchase(any()))
        .thenReturn(List.of(new ValidatedMenu(99L, "다른 메뉴", 3000, List.of())));

    assertThatThrownBy(() -> service.createOrder(7L, request()))
        .isInstanceOfSatisfying(
            BusinessException.class,
            e -> assertThat(e.errorCode()).isEqualTo(ErrorCode.UPSTREAM_INVALID_RESPONSE));
    verify(txService, never()).createTemporaryOrder(any(), any());
  }

  @Test
  void options_missing_from_menu_response_are_rejected() {
    when(menuClient.validatePurchase(any()))
        .thenReturn(List.of(new ValidatedMenu(1L, "아메리카노", 3000, List.of())));

    assertThatThrownBy(() -> service.createOrder(7L, request()))
        .isInstanceOfSatisfying(
            BusinessException.class,
            e -> assertThat(e.errorCode()).isEqualTo(ErrorCode.UPSTREAM_INVALID_RESPONSE));
  }

  @Test
  void out_of_stock_marks_order_failed_and_rethrows() {
    when(menuClient.validatePurchase(any())).thenReturn(menuResponse());
    when(txService.createTemporaryOrder(eq(7L), any())).thenReturn(100L);
    when(inventoryClient.hold(eq(100L), any()))
        .thenThrow(new BusinessException(ErrorCode.OUT_OF_STOCK));

    assertThatThrownBy(() -> service.createOrder(7L, request()))
        .isInstanceOfSatisfying(
            BusinessException.class,
            e -> assertThat(e.errorCode()).isEqualTo(ErrorCode.OUT_OF_STOCK));
    verify(txService).markFailed(100L, "OUT_OF_STOCK");
    verify(txService, never()).markHeld(any(), any());
  }

  @Test
  void create_success_prices_from_menu_response_and_holds_stock_per_menu() {
    when(menuClient.validatePurchase(any())).thenReturn(menuResponse());
    when(txService.createTemporaryOrder(eq(7L), any())).thenReturn(100L);
    StockHold hold = new StockHold(55L, now.plusMinutes(5));
    when(inventoryClient.hold(eq(100L), any())).thenReturn(hold);
    OrderDetailResponse expected = mock(OrderDetailResponse.class);
    when(txService.markHeld(100L, hold)).thenReturn(expected);

    OrderDetailResponse actual = service.createOrder(7L, request());

    assertThat(actual).isSameAs(expected);
    @SuppressWarnings("unchecked")
    ArgumentCaptor<List<HoldLine>> holdLines = ArgumentCaptor.forClass(List.class);
    verify(inventoryClient).hold(eq(100L), holdLines.capture());
    assertThat(holdLines.getValue()).containsExactly(new HoldLine(1L, 2));
  }

  @Test
  void hold_save_failure_releases_the_stock_and_fails_the_order_then_rethrows() {
    when(menuClient.validatePurchase(any())).thenReturn(menuResponse());
    when(txService.createTemporaryOrder(eq(7L), any())).thenReturn(100L);
    StockHold hold = new StockHold(55L, now.plusMinutes(5));
    when(inventoryClient.hold(eq(100L), any())).thenReturn(hold);
    IllegalStateException dbError = new IllegalStateException("db down");
    when(txService.markHeld(100L, hold)).thenThrow(dbError);

    assertThatThrownBy(() -> service.createOrder(7L, request())).isSameAs(dbError);

    verify(inventoryClient).release(55L);
    verify(txService).markFailed(100L, "HOLD_SAVE_FAILED");
  }

  @Test
  void hold_save_failure_still_rethrows_the_original_error_when_compensation_also_fails() {
    when(menuClient.validatePurchase(any())).thenReturn(menuResponse());
    when(txService.createTemporaryOrder(eq(7L), any())).thenReturn(100L);
    StockHold hold = new StockHold(55L, now.plusMinutes(5));
    when(inventoryClient.hold(eq(100L), any())).thenReturn(hold);
    IllegalStateException dbError = new IllegalStateException("db down");
    when(txService.markHeld(100L, hold)).thenThrow(dbError);
    org.mockito.Mockito.doThrow(new BusinessException(ErrorCode.INVENTORY_SERVICE_UNAVAILABLE))
        .when(inventoryClient)
        .release(55L);
    org.mockito.Mockito.doThrow(new IllegalStateException("db still down"))
        .when(txService)
        .markFailed(100L, "HOLD_SAVE_FAILED");

    assertThatThrownBy(() -> service.createOrder(7L, request())).isSameAs(dbError);

    verify(inventoryClient).release(55L);
    verify(txService).markFailed(100L, "HOLD_SAVE_FAILED");
  }

  @Test
  void same_menu_in_multiple_lines_is_summed_for_stock_hold() {
    CreateOrderRequest req =
        new CreateOrderRequest(
            List.of(new OrderLine(1L, 2, List.of()), new OrderLine(1L, 3, List.of(10L))));
    when(menuClient.validatePurchase(any()))
        .thenReturn(
            List.of(
                new ValidatedMenu(1L, "아메리카노", 3000, List.of()),
                new ValidatedMenu(
                    1L, "아메리카노", 3000, List.of(new ValidatedOption(10L, "샷 추가", 500)))));
    when(txService.createTemporaryOrder(eq(7L), any())).thenReturn(100L);
    when(inventoryClient.hold(eq(100L), any())).thenReturn(new StockHold(55L, now.plusMinutes(5)));
    when(txService.markHeld(eq(100L), any())).thenReturn(mock(OrderDetailResponse.class));

    service.createOrder(7L, req);

    @SuppressWarnings("unchecked")
    ArgumentCaptor<List<HoldLine>> holdLines = ArgumentCaptor.forClass(List.class);
    verify(inventoryClient).hold(eq(100L), holdLines.capture());
    assertThat(holdLines.getValue()).containsExactly(new HoldLine(1L, 5));
  }

  @Test
  void detail_of_another_users_order_is_not_found() {
    when(txService.findDetail(7L, 5L)).thenReturn(Optional.empty());

    assertThatThrownBy(() -> service.getOrder(7L, 5L))
        .isInstanceOfSatisfying(
            BusinessException.class,
            e -> assertThat(e.errorCode()).isEqualTo(ErrorCode.ORDER_NOT_FOUND));
  }

  @Test
  void list_excludes_unconfirmed_orders_and_clamps_paging() {
    Order paid = Order.createTemporary(7L, now);
    paid.addItem(1L, "아메리카노", 3000, 1, List.of());
    paid.changeStatus(OrderStatus.PAID, null, now);
    Page<Order> page = new PageImpl<>(List.of(paid));
    when(orderRepository.findByUserIdAndStatusNotIn(eq(7L), any(), any(Pageable.class)))
        .thenReturn(page);

    OrderListResponse response = service.listOrders(7L, -3, 9999);

    assertThat(response.page()).isZero();
    assertThat(response.size()).isEqualTo(100);
    assertThat(response.items()).hasSize(1);
    assertThat(response.items().get(0).representativeMenuName()).isEqualTo("아메리카노");
    @SuppressWarnings("unchecked")
    ArgumentCaptor<java.util.Collection<OrderStatus>> excluded =
        ArgumentCaptor.forClass(java.util.Collection.class);
    verify(orderRepository)
        .findByUserIdAndStatusNotIn(eq(7L), excluded.capture(), any(Pageable.class));
    assertThat(excluded.getValue())
        .containsExactlyInAnyOrder(OrderStatus.CREATED, OrderStatus.FAILED);
  }

  // ---- OR-02 결제 ----

  private PaymentTarget target(OrderStatus status, Long holdId, OffsetDateTime holdExpiresAt) {
    return target(status, holdId, holdExpiresAt, null);
  }

  private PaymentTarget target(
      OrderStatus status,
      Long holdId,
      OffsetDateTime holdExpiresAt,
      OffsetDateTime paymentRequestedAt) {
    return new PaymentTarget(
        100L,
        status,
        11000,
        holdId,
        holdExpiresAt,
        paymentRequestedAt,
        payLines(),
        mock(OrderDetailResponse.class));
  }

  /** 이미 결제를 한 번 요청한 적이 있고(응답을 못 받았을 수 있음) 재고 확보도 만료된 주문. */
  private PaymentTarget retryAfterExpiry() {
    return target(OrderStatus.CREATED, 55L, now.minusMinutes(1), now.minusMinutes(6));
  }

  private PaymentTarget payable() {
    return target(OrderStatus.CREATED, 55L, now.plusMinutes(3));
  }

  private ListAppender<ILoggingEvent> captureLogs() {
    Logger logger = (Logger) LoggerFactory.getLogger(OrderService.class);
    ListAppender<ILoggingEvent> appender = new ListAppender<>();
    appender.start();
    logger.addAppender(appender);
    return appender;
  }

  private void stopCapturing(ListAppender<ILoggingEvent> appender) {
    ((Logger) LoggerFactory.getLogger(OrderService.class)).detachAppender(appender);
  }

  @Test
  void create_success_logs_order_id_and_status_without_amounts_or_user() {
    when(menuClient.validatePurchase(any())).thenReturn(menuResponse());
    when(txService.createTemporaryOrder(eq(7L), any())).thenReturn(100L);
    StockHold hold = new StockHold(55L, now.plusMinutes(5));
    when(inventoryClient.hold(eq(100L), any())).thenReturn(hold);
    OrderDetailResponse held = mock(OrderDetailResponse.class);
    when(held.orderId()).thenReturn(100L);
    when(held.status()).thenReturn(OrderStatus.CREATED);
    when(txService.markHeld(100L, hold)).thenReturn(held);
    ListAppender<ILoggingEvent> logs = captureLogs();
    try {
      service.createOrder(7L, request());
    } finally {
      stopCapturing(logs);
    }

    assertThat(logs.list)
        .extracting(ILoggingEvent::getFormattedMessage)
        .contains("주문 생성 orderId=100 status=CREATED itemCount=0");
  }

  @Test
  void pay_success_charges_confirms_stock_then_confirms_order() {
    when(txService.findPaymentTarget(7L, 100L)).thenReturn(payable());
    when(paymentClient.pay(100L, 11000, "order-100")).thenReturn(new PaymentResult(9L, "SUCCESS"));
    OrderDetailResponse confirmed = mock(OrderDetailResponse.class);
    when(txService.confirmOrder(eq(100L), eq(LOCK), eq(9L), any())).thenReturn(confirmed);

    OrderDetailResponse actual = service.payOrder(7L, 100L);

    assertThat(actual).isSameAs(confirmed);
    org.mockito.InOrder order =
        org.mockito.Mockito.inOrder(menuClient, paymentClient, inventoryClient, txService);
    order.verify(menuClient).validatePurchase(payLines());
    order.verify(paymentClient).pay(100L, 11000, "order-100");
    order.verify(inventoryClient).confirm(55L);
    order.verify(txService).confirmOrder(100L, LOCK, 9L, cookedMenus());
    verify(txService, never()).markFailed(any(), any(), any());
  }

  @Test
  void pay_on_already_confirmed_order_returns_current_state_without_charging_again() {
    PaymentTarget paid = target(OrderStatus.PAID, 55L, now.plusMinutes(3));
    when(txService.findPaymentTarget(7L, 100L)).thenReturn(paid);

    OrderDetailResponse actual = service.payOrder(7L, 100L);

    assertThat(actual).isSameAs(paid.detail());
    verify(paymentClient, never()).pay(any(), org.mockito.ArgumentMatchers.anyInt(), any());
    verify(txService, never()).confirmOrder(any(), any(), any(), any());
  }

  @Test
  void pay_rejects_failed_or_canceled_orders() {
    for (OrderStatus status : List.of(OrderStatus.FAILED, OrderStatus.CANCELED)) {
      when(txService.findPaymentTarget(7L, 100L))
          .thenReturn(target(status, 55L, now.plusMinutes(3)));

      assertThatThrownBy(() -> service.payOrder(7L, 100L))
          .isInstanceOfSatisfying(
              BusinessException.class,
              e -> assertThat(e.errorCode()).isEqualTo(ErrorCode.ORDER_NOT_PAYABLE));
    }
    verify(paymentClient, never()).pay(any(), org.mockito.ArgumentMatchers.anyInt(), any());
  }

  @Test
  void pay_rejects_order_without_stock_hold() {
    when(txService.findPaymentTarget(7L, 100L)).thenReturn(target(OrderStatus.CREATED, null, null));

    assertThatThrownBy(() -> service.payOrder(7L, 100L))
        .isInstanceOfSatisfying(
            BusinessException.class,
            e -> assertThat(e.errorCode()).isEqualTo(ErrorCode.ORDER_NOT_PAYABLE));
  }

  @Test
  void pay_after_hold_expired_fails_order_without_charging() {
    when(txService.findPaymentTarget(7L, 100L))
        .thenReturn(target(OrderStatus.CREATED, 55L, now.minusSeconds(1)));

    assertThatThrownBy(() -> service.payOrder(7L, 100L))
        .isInstanceOfSatisfying(
            BusinessException.class,
            e -> assertThat(e.errorCode()).isEqualTo(ErrorCode.HOLD_EXPIRED));
    verify(txService).markFailed(100L, LOCK, "HOLD_EXPIRED");
    verify(paymentClient, never()).pay(any(), org.mockito.ArgumentMatchers.anyInt(), any());
  }

  @Test
  void pay_failure_fails_order_and_releases_stock() {
    when(txService.findPaymentTarget(7L, 100L)).thenReturn(payable());
    when(paymentClient.pay(100L, 11000, "order-100")).thenReturn(new PaymentResult(9L, "FAILED"));

    assertThatThrownBy(() -> service.payOrder(7L, 100L))
        .isInstanceOfSatisfying(
            BusinessException.class,
            e -> assertThat(e.errorCode()).isEqualTo(ErrorCode.PAYMENT_FAILED));
    verify(txService).markFailed(100L, LOCK, "PAYMENT_FAILED");
    verify(inventoryClient).release(55L);
    verify(inventoryClient, never()).confirm(any());
  }

  @Test
  void already_refunded_payment_on_retry_ends_the_order_without_refunding_again() {
    when(txService.findPaymentTarget(7L, 100L)).thenReturn(retryAfterExpiry());
    when(paymentClient.pay(100L, 11000, "order-100")).thenReturn(new PaymentResult(9L, "REFUNDED"));

    assertThatThrownBy(() -> service.payOrder(7L, 100L))
        .isInstanceOfSatisfying(
            BusinessException.class,
            e -> assertThat(e.errorCode()).isEqualTo(ErrorCode.PAYMENT_FAILED));

    verify(txService).markFailed(100L, LOCK, "PAYMENT_REFUNDED");
    verify(paymentClient, never()).refund(any());
    verify(inventoryClient, never()).confirm(any());
    verify(inventoryClient).release(55L);
  }

  @Test
  void pay_failure_still_ends_order_when_stock_release_fails() {
    when(txService.findPaymentTarget(7L, 100L)).thenReturn(payable());
    when(paymentClient.pay(100L, 11000, "order-100")).thenReturn(new PaymentResult(9L, "FAILED"));
    org.mockito.Mockito.doThrow(new BusinessException(ErrorCode.INVENTORY_SERVICE_UNAVAILABLE))
        .when(inventoryClient)
        .release(55L);

    assertThatThrownBy(() -> service.payOrder(7L, 100L))
        .isInstanceOfSatisfying(
            BusinessException.class,
            e -> assertThat(e.errorCode()).isEqualTo(ErrorCode.PAYMENT_FAILED));
    verify(txService).markFailed(100L, LOCK, "PAYMENT_FAILED");
  }

  // ---- 같은 주문을 동시에 결제 처리하는 경합 (리뷰: 확정된 주문이 환불되는 위험) ----

  @Test
  void pay_is_answered_without_calling_anyone_while_another_request_is_processing_the_order() {
    when(txService.findPaymentTarget(7L, 100L)).thenReturn(payable());
    when(txService.tryAcquirePayLock(100L)).thenReturn(Optional.empty());

    assertThatThrownBy(() -> service.payOrder(7L, 100L))
        .isInstanceOfSatisfying(
            BusinessException.class,
            e -> assertThat(e.errorCode()).isEqualTo(ErrorCode.ORDER_PAY_IN_PROGRESS));

    verify(menuClient, never()).validatePurchase(any());
    verify(paymentClient, never()).pay(any(), org.mockito.ArgumentMatchers.anyInt(), any());
    verify(paymentClient, never()).refund(any());
    verify(txService, never()).markFailed(any(), any(), any());
    verify(txService, never()).releasePayLock(any(), any());
  }

  @Test
  void request_that_lost_the_race_returns_the_order_the_winner_already_confirmed() {
    PaymentTarget paid = target(OrderStatus.PAID, 55L, now.plusMinutes(3));
    when(txService.findPaymentTarget(7L, 100L)).thenReturn(payable(), paid);
    when(txService.tryAcquirePayLock(100L)).thenReturn(Optional.empty());

    assertThat(service.payOrder(7L, 100L)).isSameAs(paid.detail());

    verify(paymentClient, never()).refund(any());
    verify(txService, never()).markFailed(any(), any(), any());
  }

  @Test
  void request_that_lost_the_race_to_a_failed_order_is_rejected_as_not_payable() {
    when(txService.findPaymentTarget(7L, 100L))
        .thenReturn(payable(), target(OrderStatus.FAILED, 55L, now.plusMinutes(3)));
    when(txService.tryAcquirePayLock(100L)).thenReturn(Optional.empty());

    assertThatThrownBy(() -> service.payOrder(7L, 100L))
        .isInstanceOfSatisfying(
            BusinessException.class,
            e -> assertThat(e.errorCode()).isEqualTo(ErrorCode.ORDER_NOT_PAYABLE));
  }

  @Test
  void state_is_read_again_after_the_lock_so_an_order_confirmed_in_between_is_not_refunded() {
    // 처음 읽을 때는 CREATED(결제 요청 기록 있음), 독점을 잡고 다시 읽으니 이미 PAID, 메뉴는 판매 중지
    PaymentTarget paid = target(OrderStatus.PAID, 55L, now.plusMinutes(3));
    when(txService.findPaymentTarget(7L, 100L)).thenReturn(retryAfterExpiry(), paid);
    when(menuClient.validatePurchase(any()))
        .thenThrow(new BusinessException(ErrorCode.MENU_NOT_AVAILABLE));

    assertThat(service.payOrder(7L, 100L)).isSameAs(paid.detail());

    verify(menuClient, never()).validatePurchase(any());
    verify(paymentClient, never()).pay(any(), org.mockito.ArgumentMatchers.anyInt(), any());
    verify(paymentClient, never()).refund(any());
    verify(txService, never()).markFailed(any(), any(), any());
    verify(txService).releasePayLock(100L, LOCK);
  }

  @Test
  void payment_is_not_requested_when_the_order_is_no_longer_created_at_marker_time() {
    when(txService.findPaymentTarget(7L, 100L)).thenReturn(payable());
    when(txService.markPaymentRequested(100L, LOCK)).thenReturn(false);

    assertThatThrownBy(() -> service.payOrder(7L, 100L))
        .isInstanceOfSatisfying(
            BusinessException.class,
            e -> assertThat(e.errorCode()).isEqualTo(ErrorCode.ORDER_PAY_IN_PROGRESS));

    verify(paymentClient, never()).pay(any(), org.mockito.ArgumentMatchers.anyInt(), any());
    verify(txService, never()).markFailed(any(), any(), any());
    verify(txService).releasePayLock(100L, LOCK);
  }

  @Test
  void the_lock_is_released_after_success_and_after_any_failure() {
    when(txService.findPaymentTarget(7L, 100L)).thenReturn(payable());
    when(paymentClient.pay(100L, 11000, "order-100")).thenReturn(new PaymentResult(9L, "SUCCESS"));
    when(txService.confirmOrder(eq(100L), eq(LOCK), eq(9L), any()))
        .thenReturn(mock(OrderDetailResponse.class));
    service.payOrder(7L, 100L);
    verify(txService).releasePayLock(100L, LOCK);

    org.mockito.Mockito.clearInvocations(txService);
    when(txService.findPaymentTarget(7L, 100L)).thenReturn(payable());
    when(paymentClient.pay(100L, 11000, "order-100"))
        .thenThrow(new BusinessException(ErrorCode.PAYMENT_SERVICE_UNAVAILABLE));
    assertThatThrownBy(() -> service.payOrder(7L, 100L)).isInstanceOf(BusinessException.class);
    verify(txService).releasePayLock(100L, LOCK);
  }

  @Test
  void failing_to_release_the_lock_does_not_change_the_result() {
    when(txService.findPaymentTarget(7L, 100L)).thenReturn(payable());
    when(paymentClient.pay(100L, 11000, "order-100")).thenReturn(new PaymentResult(9L, "SUCCESS"));
    OrderDetailResponse confirmed = mock(OrderDetailResponse.class);
    when(txService.confirmOrder(eq(100L), eq(LOCK), eq(9L), any())).thenReturn(confirmed);
    org.mockito.Mockito.doThrow(new IllegalStateException("db down"))
        .when(txService)
        .releasePayLock(100L, LOCK);

    assertThat(service.payOrder(7L, 100L)).isSameAs(confirmed);
  }

  @Test
  void the_lock_is_taken_before_menu_and_payment_are_called() {
    when(txService.findPaymentTarget(7L, 100L)).thenReturn(payable());
    when(paymentClient.pay(100L, 11000, "order-100")).thenReturn(new PaymentResult(9L, "SUCCESS"));
    when(txService.confirmOrder(eq(100L), eq(LOCK), eq(9L), any()))
        .thenReturn(mock(OrderDetailResponse.class));

    service.payOrder(7L, 100L);

    org.mockito.InOrder order = org.mockito.Mockito.inOrder(txService, menuClient, paymentClient);
    order.verify(txService).tryAcquirePayLock(100L);
    order.verify(menuClient).validatePurchase(any());
    order.verify(paymentClient).pay(100L, 11000, "order-100");
    order.verify(txService).releasePayLock(100L, LOCK);
  }

  // ---- 독점 소유권: 만료 후 다른 요청이 이어받은 뒤 늦게 도착한 이전 요청 ----

  private void loseLockFromNowOn() {
    when(txService.renewPayLock(any(), any())).thenReturn(false);
  }

  @Test
  void a_request_that_lost_the_lock_does_not_confirm_stock_after_paying() {
    when(txService.findPaymentTarget(7L, 100L)).thenReturn(payable());
    when(paymentClient.pay(100L, 11000, "order-100")).thenReturn(new PaymentResult(9L, "SUCCESS"));
    loseLockFromNowOn();

    assertThatThrownBy(() -> service.payOrder(7L, 100L))
        .isInstanceOfSatisfying(
            BusinessException.class,
            e -> assertThat(e.errorCode()).isEqualTo(ErrorCode.ORDER_PAY_IN_PROGRESS));

    verify(inventoryClient, never()).confirm(any());
    verify(paymentClient, never()).refund(any());
    verify(txService, never()).confirmOrder(any(), any(), any(), any());
    verify(txService, never()).markFailed(any(), any(), any());
  }

  @Test
  void a_request_that_lost_the_lock_does_not_refund_after_stock_confirm_is_rejected() {
    when(txService.findPaymentTarget(7L, 100L)).thenReturn(payable());
    when(paymentClient.pay(100L, 11000, "order-100")).thenReturn(new PaymentResult(9L, "SUCCESS"));
    // 재고 확정 전 확인은 통과하고, 거절된 뒤 환불 전 확인에서 독점을 잃었다
    when(txService.renewPayLock(any(), any())).thenReturn(true, false);
    org.mockito.Mockito.doThrow(new BusinessException(ErrorCode.STOCK_CONFIRM_FAILED))
        .when(inventoryClient)
        .confirm(55L);

    assertThatThrownBy(() -> service.payOrder(7L, 100L)).isInstanceOf(BusinessException.class);

    verify(paymentClient, never()).refund(any());
    verify(txService, never()).markFailed(any(), any(), any());
  }

  @Test
  void a_request_that_lost_the_lock_does_not_call_payment_or_refund_on_the_recovery_path() {
    when(txService.findPaymentTarget(7L, 100L)).thenReturn(retryAfterExpiry());
    org.mockito.Mockito.doThrow(new BusinessException(ErrorCode.MENU_NOT_AVAILABLE))
        .when(menuClient)
        .validatePurchase(any());
    loseLockFromNowOn();

    assertThatThrownBy(() -> service.payOrder(7L, 100L)).isInstanceOf(BusinessException.class);

    verify(paymentClient, never()).pay(any(), org.mockito.ArgumentMatchers.anyInt(), any());
    verify(paymentClient, never()).refund(any());
    verify(txService, never()).markFailed(any(), any(), any());
    verify(inventoryClient, never()).release(any());
  }

  @Test
  void recovery_path_does_not_refund_when_the_lock_is_lost_after_the_payment_check() {
    when(txService.findPaymentTarget(7L, 100L)).thenReturn(retryAfterExpiry());
    org.mockito.Mockito.doThrow(new BusinessException(ErrorCode.MENU_NOT_AVAILABLE))
        .when(menuClient)
        .validatePurchase(any());
    when(paymentClient.pay(100L, 11000, "order-100")).thenReturn(new PaymentResult(9L, "SUCCESS"));
    when(txService.renewPayLock(any(), any())).thenReturn(true, false);

    assertThatThrownBy(() -> service.payOrder(7L, 100L)).isInstanceOf(BusinessException.class);

    verify(paymentClient, never()).refund(any());
    verify(txService, never()).markFailed(any(), any(), any());
    verify(inventoryClient, never()).release(any());
  }

  @Test
  void stock_is_not_released_when_failing_the_order_was_refused_because_the_lock_was_lost() {
    when(txService.findPaymentTarget(7L, 100L)).thenReturn(payable());
    when(paymentClient.pay(100L, 11000, "order-100")).thenReturn(new PaymentResult(9L, "FAILED"));
    when(txService.markFailed(any(), any(), any())).thenReturn(false);

    assertThatThrownBy(() -> service.payOrder(7L, 100L)).isInstanceOf(BusinessException.class);

    verify(inventoryClient, never()).release(any());
  }

  @Test
  void the_lock_is_checked_before_every_external_side_effect_and_only_my_token_is_released() {
    when(txService.findPaymentTarget(7L, 100L)).thenReturn(payable());
    when(paymentClient.pay(100L, 11000, "order-100")).thenReturn(new PaymentResult(9L, "SUCCESS"));
    org.mockito.Mockito.doThrow(new BusinessException(ErrorCode.STOCK_CONFIRM_FAILED))
        .when(inventoryClient)
        .confirm(55L);

    assertThatThrownBy(() -> service.payOrder(7L, 100L)).isInstanceOf(BusinessException.class);

    org.mockito.InOrder order =
        org.mockito.Mockito.inOrder(txService, paymentClient, inventoryClient);
    order.verify(txService).markPaymentRequested(100L, LOCK);
    order.verify(paymentClient).pay(100L, 11000, "order-100");
    order.verify(txService).renewPayLock(100L, LOCK);
    order.verify(inventoryClient).confirm(55L);
    order.verify(txService).renewPayLock(100L, LOCK);
    order.verify(paymentClient).refund(9L);
    order.verify(txService).markFailed(100L, LOCK, "STOCK_CONFIRM_FAILED");
    order.verify(txService).releasePayLock(100L, LOCK);
    verify(txService, never())
        .releasePayLock(any(), org.mockito.ArgumentMatchers.argThat(t -> !LOCK.equals(t)));
  }

  @Test
  void a_new_request_after_the_lock_was_taken_over_gets_its_own_token() {
    java.util.UUID tokenB = java.util.UUID.fromString("00000000-0000-0000-0000-000000000099");
    when(txService.tryAcquirePayLock(100L)).thenReturn(Optional.of(LOCK), Optional.of(tokenB));
    when(txService.findPaymentTarget(7L, 100L)).thenReturn(payable());
    when(paymentClient.pay(100L, 11000, "order-100")).thenReturn(new PaymentResult(9L, "SUCCESS"));
    when(txService.confirmOrder(eq(100L), any(), eq(9L), any()))
        .thenReturn(mock(OrderDetailResponse.class));

    service.payOrder(7L, 100L);
    service.payOrder(7L, 100L);

    verify(txService).releasePayLock(100L, LOCK);
    verify(txService).releasePayLock(100L, tokenB);
    verify(txService).confirmOrder(eq(100L), eq(tokenB), eq(9L), any());
  }

  // ---- 결제 결과를 모른 채 재시도하는 경로 (리뷰: 결제 성공 + 응답 유실 + 확보 만료) ----

  @Test
  void payment_is_marked_as_requested_before_it_is_called_and_the_id_is_saved_right_after() {
    when(txService.findPaymentTarget(7L, 100L)).thenReturn(payable());
    when(paymentClient.pay(100L, 11000, "order-100")).thenReturn(new PaymentResult(9L, "SUCCESS"));
    when(txService.confirmOrder(eq(100L), eq(LOCK), eq(9L), any()))
        .thenReturn(mock(OrderDetailResponse.class));

    service.payOrder(7L, 100L);

    org.mockito.InOrder order =
        org.mockito.Mockito.inOrder(txService, paymentClient, inventoryClient);
    order.verify(txService).markPaymentRequested(100L, LOCK);
    order.verify(paymentClient).pay(100L, 11000, "order-100");
    order.verify(txService).recordPaymentId(100L, LOCK, 9L);
    order.verify(inventoryClient).confirm(55L);
    order.verify(txService).confirmOrder(eq(100L), eq(LOCK), eq(9L), any());
  }

  @Test
  void payment_is_not_requested_when_the_request_marker_cannot_be_saved() {
    when(txService.findPaymentTarget(7L, 100L)).thenReturn(payable());
    org.mockito.Mockito.doThrow(new IllegalStateException("db down"))
        .when(txService)
        .markPaymentRequested(100L, LOCK);

    assertThatThrownBy(() -> service.payOrder(7L, 100L)).isInstanceOf(IllegalStateException.class);

    verify(paymentClient, never()).pay(any(), org.mockito.ArgumentMatchers.anyInt(), any());
    verify(txService, never()).markFailed(any(), any(), any());
  }

  @Test
  void expired_hold_without_any_payment_attempt_ends_the_order_without_calling_payment() {
    when(txService.findPaymentTarget(7L, 100L))
        .thenReturn(target(OrderStatus.CREATED, 55L, now.minusMinutes(1)));

    assertThatThrownBy(() -> service.payOrder(7L, 100L))
        .isInstanceOfSatisfying(
            BusinessException.class,
            e -> assertThat(e.errorCode()).isEqualTo(ErrorCode.HOLD_EXPIRED));

    verify(txService).markFailed(100L, LOCK, "HOLD_EXPIRED");
    verify(paymentClient, never()).pay(any(), org.mockito.ArgumentMatchers.anyInt(), any());
  }

  @Test
  void
      retry_after_expiry_reuses_the_same_payment_key_and_completes_when_stock_can_still_be_confirmed() {
    when(txService.findPaymentTarget(7L, 100L)).thenReturn(retryAfterExpiry());
    when(paymentClient.pay(100L, 11000, "order-100")).thenReturn(new PaymentResult(9L, "SUCCESS"));
    OrderDetailResponse confirmed = mock(OrderDetailResponse.class);
    when(txService.confirmOrder(eq(100L), eq(LOCK), eq(9L), any())).thenReturn(confirmed);

    assertThat(service.payOrder(7L, 100L)).isSameAs(confirmed);

    verify(inventoryClient).confirm(55L);
    verify(txService, never()).markFailed(any(), any(), any());
  }

  @Test
  void retry_after_expiry_refunds_and_ends_the_order_when_stock_confirm_is_rejected() {
    when(txService.findPaymentTarget(7L, 100L)).thenReturn(retryAfterExpiry());
    when(paymentClient.pay(100L, 11000, "order-100")).thenReturn(new PaymentResult(9L, "SUCCESS"));
    org.mockito.Mockito.doThrow(new BusinessException(ErrorCode.STOCK_CONFIRM_FAILED))
        .when(inventoryClient)
        .confirm(55L);

    assertThatThrownBy(() -> service.payOrder(7L, 100L))
        .isInstanceOfSatisfying(
            BusinessException.class,
            e -> assertThat(e.errorCode()).isEqualTo(ErrorCode.STOCK_CONFIRM_FAILED));

    verify(paymentClient).refund(9L);
    verify(txService).markFailed(100L, LOCK, "STOCK_CONFIRM_FAILED");
  }

  @Test
  void retry_after_expiry_marks_refund_needed_when_the_refund_also_fails() {
    when(txService.findPaymentTarget(7L, 100L)).thenReturn(retryAfterExpiry());
    when(paymentClient.pay(100L, 11000, "order-100")).thenReturn(new PaymentResult(9L, "SUCCESS"));
    org.mockito.Mockito.doThrow(new BusinessException(ErrorCode.STOCK_CONFIRM_FAILED))
        .when(inventoryClient)
        .confirm(55L);
    org.mockito.Mockito.doThrow(new BusinessException(ErrorCode.PAYMENT_SERVICE_UNAVAILABLE))
        .when(paymentClient)
        .refund(9L);

    assertThatThrownBy(() -> service.payOrder(7L, 100L)).isInstanceOf(BusinessException.class);

    verify(txService).markFailed(100L, LOCK, "STOCK_CONFIRM_FAILED_REFUND_NEEDED");
  }

  @Test
  void retry_after_expiry_ends_the_order_without_refund_when_the_payment_had_failed() {
    when(txService.findPaymentTarget(7L, 100L)).thenReturn(retryAfterExpiry());
    when(paymentClient.pay(100L, 11000, "order-100")).thenReturn(new PaymentResult(9L, "FAILED"));

    assertThatThrownBy(() -> service.payOrder(7L, 100L))
        .isInstanceOfSatisfying(
            BusinessException.class,
            e -> assertThat(e.errorCode()).isEqualTo(ErrorCode.PAYMENT_FAILED));

    verify(txService).markFailed(100L, LOCK, "PAYMENT_FAILED");
    verify(paymentClient, never()).refund(any());
  }

  @Test
  void retry_after_expiry_keeps_the_order_when_the_payment_result_is_still_unknown() {
    when(txService.findPaymentTarget(7L, 100L)).thenReturn(retryAfterExpiry());
    when(paymentClient.pay(100L, 11000, "order-100"))
        .thenThrow(new BusinessException(ErrorCode.PAYMENT_SERVICE_UNAVAILABLE));

    assertThatThrownBy(() -> service.payOrder(7L, 100L))
        .isInstanceOfSatisfying(
            BusinessException.class,
            e -> assertThat(e.errorCode()).isEqualTo(ErrorCode.PAYMENT_SERVICE_UNAVAILABLE));

    verify(txService, never()).markFailed(any(), any(), any());
    verify(inventoryClient, never()).confirm(any());
  }

  @Test
  void stock_confirm_result_unknown_keeps_the_order_and_the_saved_payment_id_for_recovery() {
    when(txService.findPaymentTarget(7L, 100L)).thenReturn(payable());
    when(paymentClient.pay(100L, 11000, "order-100")).thenReturn(new PaymentResult(9L, "SUCCESS"));
    org.mockito.Mockito.doThrow(new BusinessException(ErrorCode.INVENTORY_SERVICE_UNAVAILABLE))
        .when(inventoryClient)
        .confirm(55L);

    assertThatThrownBy(() -> service.payOrder(7L, 100L)).isInstanceOf(BusinessException.class);

    verify(txService).recordPaymentId(100L, LOCK, 9L);
    verify(txService, never()).markFailed(any(), any(), any());
    verify(paymentClient, never()).refund(any());
  }

  @Test
  void payment_id_save_failure_does_not_stop_the_order_from_being_confirmed() {
    when(txService.findPaymentTarget(7L, 100L)).thenReturn(payable());
    when(paymentClient.pay(100L, 11000, "order-100")).thenReturn(new PaymentResult(9L, "SUCCESS"));
    org.mockito.Mockito.doThrow(new IllegalStateException("db down"))
        .when(txService)
        .recordPaymentId(100L, LOCK, 9L);
    OrderDetailResponse confirmed = mock(OrderDetailResponse.class);
    when(txService.confirmOrder(eq(100L), eq(LOCK), eq(9L), any())).thenReturn(confirmed);

    assertThat(service.payOrder(7L, 100L)).isSameAs(confirmed);
  }

  @Test
  void menu_unavailable_on_retry_refunds_a_payment_that_had_succeeded_instead_of_just_failing() {
    when(txService.findPaymentTarget(7L, 100L))
        .thenReturn(target(OrderStatus.CREATED, 55L, now.plusMinutes(3), now.minusMinutes(1)));
    when(menuClient.validatePurchase(any()))
        .thenThrow(new BusinessException(ErrorCode.MENU_NOT_AVAILABLE));
    when(paymentClient.pay(100L, 11000, "order-100")).thenReturn(new PaymentResult(9L, "SUCCESS"));

    assertThatThrownBy(() -> service.payOrder(7L, 100L))
        .isInstanceOfSatisfying(
            BusinessException.class,
            e -> assertThat(e.errorCode()).isEqualTo(ErrorCode.MENU_NOT_AVAILABLE));

    verify(paymentClient).refund(9L);
    verify(txService).markFailed(100L, LOCK, "MENU_NOT_AVAILABLE");
    verify(inventoryClient).release(55L);
  }

  @Test
  void menu_unavailable_on_retry_marks_refund_needed_when_the_refund_fails() {
    when(txService.findPaymentTarget(7L, 100L))
        .thenReturn(target(OrderStatus.CREATED, 55L, now.plusMinutes(3), now.minusMinutes(1)));
    when(menuClient.validatePurchase(any()))
        .thenThrow(new BusinessException(ErrorCode.MENU_NOT_AVAILABLE));
    when(paymentClient.pay(100L, 11000, "order-100")).thenReturn(new PaymentResult(9L, "SUCCESS"));
    org.mockito.Mockito.doThrow(new BusinessException(ErrorCode.PAYMENT_SERVICE_UNAVAILABLE))
        .when(paymentClient)
        .refund(9L);

    assertThatThrownBy(() -> service.payOrder(7L, 100L)).isInstanceOf(BusinessException.class);

    verify(txService).markFailed(100L, LOCK, "MENU_NOT_AVAILABLE_REFUND_NEEDED");
  }

  @Test
  void menu_unavailable_on_retry_keeps_the_order_when_the_payment_result_is_unknown() {
    when(txService.findPaymentTarget(7L, 100L))
        .thenReturn(target(OrderStatus.CREATED, 55L, now.plusMinutes(3), now.minusMinutes(1)));
    when(menuClient.validatePurchase(any()))
        .thenThrow(new BusinessException(ErrorCode.MENU_NOT_AVAILABLE));
    when(paymentClient.pay(100L, 11000, "order-100"))
        .thenThrow(new BusinessException(ErrorCode.PAYMENT_SERVICE_UNAVAILABLE));

    assertThatThrownBy(() -> service.payOrder(7L, 100L))
        .isInstanceOfSatisfying(
            BusinessException.class,
            e -> assertThat(e.errorCode()).isEqualTo(ErrorCode.PAYMENT_SERVICE_UNAVAILABLE));

    verify(txService, never()).markFailed(any(), any(), any());
  }

  @Test
  void repeated_pay_calls_on_a_confirmed_order_do_not_touch_payment_or_stock_again() {
    PaymentTarget paid = target(OrderStatus.PAID, 55L, now.minusMinutes(1), now.minusMinutes(6));
    when(txService.findPaymentTarget(7L, 100L)).thenReturn(paid);

    service.payOrder(7L, 100L);
    service.payOrder(7L, 100L);

    verify(paymentClient, never()).pay(any(), org.mockito.ArgumentMatchers.anyInt(), any());
    verify(inventoryClient, never()).confirm(any());
    verify(txService, never()).markPaymentRequested(any(), any());
  }

  @Test
  void unknown_payment_result_leaves_order_untouched_so_retry_can_continue() {
    when(txService.findPaymentTarget(7L, 100L)).thenReturn(payable());
    when(paymentClient.pay(100L, 11000, "order-100"))
        .thenThrow(new BusinessException(ErrorCode.PAYMENT_SERVICE_UNAVAILABLE));

    assertThatThrownBy(() -> service.payOrder(7L, 100L))
        .isInstanceOfSatisfying(
            BusinessException.class,
            e -> assertThat(e.errorCode()).isEqualTo(ErrorCode.PAYMENT_SERVICE_UNAVAILABLE));
    verify(txService, never()).markFailed(any(), any(), any());
    verify(inventoryClient, never()).release(any());
    verify(inventoryClient, never()).confirm(any());
  }

  @Test
  void stock_confirm_rejected_after_payment_refunds_and_fails_order() {
    when(txService.findPaymentTarget(7L, 100L)).thenReturn(payable());
    when(paymentClient.pay(100L, 11000, "order-100")).thenReturn(new PaymentResult(9L, "SUCCESS"));
    org.mockito.Mockito.doThrow(new BusinessException(ErrorCode.STOCK_CONFIRM_FAILED))
        .when(inventoryClient)
        .confirm(55L);

    assertThatThrownBy(() -> service.payOrder(7L, 100L))
        .isInstanceOfSatisfying(
            BusinessException.class,
            e -> assertThat(e.errorCode()).isEqualTo(ErrorCode.STOCK_CONFIRM_FAILED));
    verify(paymentClient).refund(9L);
    verify(txService).markFailed(100L, LOCK, "STOCK_CONFIRM_FAILED");
    verify(txService, never()).confirmOrder(any(), any(), any(), any());
  }

  @Test
  void refund_failure_is_recorded_in_fail_reason_for_manual_follow_up() {
    when(txService.findPaymentTarget(7L, 100L)).thenReturn(payable());
    when(paymentClient.pay(100L, 11000, "order-100")).thenReturn(new PaymentResult(9L, "SUCCESS"));
    org.mockito.Mockito.doThrow(new BusinessException(ErrorCode.STOCK_CONFIRM_FAILED))
        .when(inventoryClient)
        .confirm(55L);
    org.mockito.Mockito.doThrow(new BusinessException(ErrorCode.PAYMENT_SERVICE_UNAVAILABLE))
        .when(paymentClient)
        .refund(9L);

    assertThatThrownBy(() -> service.payOrder(7L, 100L)).isInstanceOf(BusinessException.class);
    verify(txService).markFailed(100L, LOCK, "STOCK_CONFIRM_FAILED_REFUND_NEEDED");
  }

  @Test
  void unknown_stock_confirm_result_does_not_refund_or_fail_order() {
    when(txService.findPaymentTarget(7L, 100L)).thenReturn(payable());
    when(paymentClient.pay(100L, 11000, "order-100")).thenReturn(new PaymentResult(9L, "SUCCESS"));
    org.mockito.Mockito.doThrow(new BusinessException(ErrorCode.INVENTORY_SERVICE_UNAVAILABLE))
        .when(inventoryClient)
        .confirm(55L);

    assertThatThrownBy(() -> service.payOrder(7L, 100L))
        .isInstanceOfSatisfying(
            BusinessException.class,
            e -> assertThat(e.errorCode()).isEqualTo(ErrorCode.INVENTORY_SERVICE_UNAVAILABLE));
    verify(paymentClient, never()).refund(any());
    verify(txService, never()).markFailed(any(), any(), any());
  }

  @Test
  void pay_fetches_cook_times_from_menu_before_charging() {
    when(txService.findPaymentTarget(7L, 100L)).thenReturn(payable());
    when(paymentClient.pay(100L, 11000, "order-100")).thenReturn(new PaymentResult(9L, "SUCCESS"));
    when(txService.confirmOrder(eq(100L), eq(LOCK), eq(9L), any()))
        .thenReturn(mock(OrderDetailResponse.class));

    service.payOrder(7L, 100L);

    @SuppressWarnings("unchecked")
    ArgumentCaptor<List<ValidatedMenu>> menus = ArgumentCaptor.forClass(List.class);
    verify(txService).confirmOrder(eq(100L), eq(LOCK), eq(9L), menus.capture());
    assertThat(menus.getValue().get(0).cookTimeSec()).isEqualTo(120);
    assertThat(menus.getValue().get(0).options().get(0).extraCookTimeSec()).isEqualTo(30);
  }

  @Test
  void menu_unreachable_at_pay_leaves_order_untouched_and_does_not_charge() {
    when(txService.findPaymentTarget(7L, 100L)).thenReturn(payable());
    when(menuClient.validatePurchase(payLines()))
        .thenThrow(new BusinessException(ErrorCode.MENU_SERVICE_UNAVAILABLE));

    assertThatThrownBy(() -> service.payOrder(7L, 100L))
        .isInstanceOfSatisfying(
            BusinessException.class,
            e -> assertThat(e.errorCode()).isEqualTo(ErrorCode.MENU_SERVICE_UNAVAILABLE));
    verify(paymentClient, never()).pay(any(), org.mockito.ArgumentMatchers.anyInt(), any());
    verify(txService, never()).markFailed(any(), any(), any());
    verify(inventoryClient, never()).release(any());
  }

  @Test
  void menu_no_longer_sellable_at_pay_fails_order_and_releases_stock_without_charging() {
    when(txService.findPaymentTarget(7L, 100L)).thenReturn(payable());
    when(menuClient.validatePurchase(payLines()))
        .thenThrow(new BusinessException(ErrorCode.MENU_NOT_AVAILABLE));

    assertThatThrownBy(() -> service.payOrder(7L, 100L))
        .isInstanceOfSatisfying(
            BusinessException.class,
            e -> assertThat(e.errorCode()).isEqualTo(ErrorCode.MENU_NOT_AVAILABLE));
    verify(txService).markFailed(100L, LOCK, "MENU_NOT_AVAILABLE");
    verify(inventoryClient).release(55L);
    verify(paymentClient, never()).pay(any(), org.mockito.ArgumentMatchers.anyInt(), any());
  }

  @Test
  void menu_response_without_cook_time_is_rejected_before_charging() {
    when(txService.findPaymentTarget(7L, 100L)).thenReturn(payable());
    when(menuClient.validatePurchase(payLines()))
        .thenReturn(
            List.of(
                new ValidatedMenu(
                    1L, "아메리카노", 3000, List.of(new ValidatedOption(10L, "샷 추가", 500)))));

    assertThatThrownBy(() -> service.payOrder(7L, 100L))
        .isInstanceOfSatisfying(
            BusinessException.class,
            e -> assertThat(e.errorCode()).isEqualTo(ErrorCode.UPSTREAM_INVALID_RESPONSE));
    verify(paymentClient, never()).pay(any(), org.mockito.ArgumentMatchers.anyInt(), any());
    verify(txService, never()).markFailed(any(), any(), any());
  }

  // ---- US-13 Cooking 장애 시 차단 ----

  private void cookingDown() {
    org.mockito.Mockito.doThrow(new BusinessException(ErrorCode.COOKING_UNAVAILABLE))
        .when(cookingAvailability)
        .ensureAvailable();
  }

  @Test
  void create_is_blocked_while_cooking_is_down_without_calling_other_services() {
    cookingDown();

    assertThatThrownBy(() -> service.createOrder(7L, request()))
        .isInstanceOfSatisfying(
            BusinessException.class,
            e -> assertThat(e.errorCode()).isEqualTo(ErrorCode.COOKING_UNAVAILABLE));
    verify(menuClient, never()).validatePurchase(any());
    verify(txService, never()).createTemporaryOrder(any(), any());
    verify(inventoryClient, never()).hold(any(), any());
  }

  @Test
  void store_closed_is_reported_before_cooking_outage() {
    when(storeRepository.findById(StoreOperation.SINGLE_STORE_ID))
        .thenReturn(Optional.of(new StoreOperation(true, false, now)));
    cookingDown();

    assertThatThrownBy(() -> service.createOrder(7L, request()))
        .isInstanceOfSatisfying(
            BusinessException.class,
            e -> assertThat(e.errorCode()).isEqualTo(ErrorCode.STORE_NOT_ACCEPTING_ORDERS));
  }

  @Test
  void pay_is_blocked_while_cooking_is_down_and_leaves_the_order_untouched() {
    when(txService.findPaymentTarget(7L, 100L)).thenReturn(payable());
    cookingDown();

    assertThatThrownBy(() -> service.payOrder(7L, 100L))
        .isInstanceOfSatisfying(
            BusinessException.class,
            e -> assertThat(e.errorCode()).isEqualTo(ErrorCode.COOKING_UNAVAILABLE));
    verify(menuClient, never()).validatePurchase(payLines());
    verify(paymentClient, never()).pay(any(), org.mockito.ArgumentMatchers.anyInt(), any());
    verify(txService, never()).markFailed(any(), any());
    verify(inventoryClient, never()).release(any());
  }

  @Test
  void
      order_with_a_payment_request_is_not_blocked_by_a_cooking_outage_so_its_result_can_be_resolved() {
    // 결제가 됐을 수 있는 주문은 같은 키로 기존 결과를 확인하는 것이라 새 결제가 아니다. 막으면 돈은 나갔는데 사용자는 "결제 불가"만 본다.
    when(txService.findPaymentTarget(7L, 100L)).thenReturn(retryAfterExpiry());
    cookingDown();
    when(paymentClient.pay(100L, 11000, "order-100")).thenReturn(new PaymentResult(9L, "SUCCESS"));
    OrderDetailResponse confirmed = mock(OrderDetailResponse.class);
    when(txService.confirmOrder(eq(100L), eq(LOCK), eq(9L), any())).thenReturn(confirmed);

    assertThat(service.payOrder(7L, 100L)).isSameAs(confirmed);

    verify(cookingAvailability, never()).ensureAvailable();
  }

  @Test
  void
      order_with_a_payment_request_is_refunded_when_stock_confirm_is_rejected_during_a_cooking_outage() {
    when(txService.findPaymentTarget(7L, 100L)).thenReturn(retryAfterExpiry());
    cookingDown();
    when(paymentClient.pay(100L, 11000, "order-100")).thenReturn(new PaymentResult(9L, "SUCCESS"));
    org.mockito.Mockito.doThrow(new BusinessException(ErrorCode.STOCK_CONFIRM_FAILED))
        .when(inventoryClient)
        .confirm(55L);

    assertThatThrownBy(() -> service.payOrder(7L, 100L)).isInstanceOf(BusinessException.class);

    verify(paymentClient).refund(9L);
    verify(txService).markFailed(100L, LOCK, "STOCK_CONFIRM_FAILED");
  }

  @Test
  void already_confirmed_order_can_still_be_read_through_pay_while_cooking_is_down() {
    PaymentTarget paid = target(OrderStatus.PAID, 55L, now.plusMinutes(3));
    when(txService.findPaymentTarget(7L, 100L)).thenReturn(paid);
    cookingDown();

    assertThat(service.payOrder(7L, 100L)).isSameAs(paid.detail());
    verify(cookingAvailability, never()).ensureAvailable();
  }

  @Test
  void expired_hold_is_still_closed_even_while_cooking_is_down() {
    when(txService.findPaymentTarget(7L, 100L))
        .thenReturn(target(OrderStatus.CREATED, 55L, now.minusSeconds(1)));
    cookingDown();

    assertThatThrownBy(() -> service.payOrder(7L, 100L))
        .isInstanceOfSatisfying(
            BusinessException.class,
            e -> assertThat(e.errorCode()).isEqualTo(ErrorCode.HOLD_EXPIRED));
    verify(txService).markFailed(100L, LOCK, "HOLD_EXPIRED");
  }

  @Test
  void read_apis_are_not_affected_by_cooking_outage() {
    cookingDown();
    when(txService.findDetail(7L, 5L)).thenReturn(Optional.empty());

    assertThatThrownBy(() -> service.getOrder(7L, 5L))
        .isInstanceOfSatisfying(
            BusinessException.class,
            e -> assertThat(e.errorCode()).isEqualTo(ErrorCode.ORDER_NOT_FOUND));
    verify(cookingAvailability, never()).ensureAvailable();
  }

  // ---- OR-04 조리 상태 ----

  private OrderDetailResponse detailWithStatus(OrderStatus status) {
    Order order = Order.createTemporary(7L, now);
    order.addItem(1L, "아메리카노", 3000, 1, List.of());
    if (status != OrderStatus.CREATED) {
      order.changeStatus(status, null, now);
    }
    return OrderDetailResponse.from(order);
  }

  @Test
  void paid_order_detail_includes_cooking_status() {
    when(txService.findDetail(7L, 5L)).thenReturn(Optional.of(detailWithStatus(OrderStatus.PAID)));
    when(cookingClient.getStatus(any()))
        .thenReturn(
            Optional.of(
                new CookingClient.CookingStatus(
                    "COOKING", 0, 120, 0, 45, OffsetDateTime.parse("2026-11-19T01:00:00Z"))));

    OrderDetailResponse r = service.getOrder(7L, 5L);

    assertThat(r.cooking().lookup()).isEqualTo(OrderDetailResponse.Lookup.OK);
    assertThat(r.cooking().status()).isEqualTo("COOKING");
    assertThat(r.cooking().expectedWaitSec()).isZero();
    assertThat(r.cooking().expectedReadySec()).isEqualTo(45);
    // 시각은 KST(+09:00)로 내린다.
    assertThat(r.cooking().startedAt().getOffset().getTotalSeconds()).isEqualTo(9 * 3600);
    assertThat(r.cooking().startedAt().toInstant())
        .isEqualTo(OffsetDateTime.parse("2026-11-19T10:00:00+09:00").toInstant());
  }

  @Test
  void missing_ticket_is_pending_and_failures_are_unavailable_without_failing_the_detail() {
    when(txService.findDetail(7L, 5L)).thenReturn(Optional.of(detailWithStatus(OrderStatus.PAID)));
    when(cookingClient.getStatus(any())).thenReturn(Optional.empty());
    assertThat(service.getOrder(7L, 5L).cooking().lookup())
        .isEqualTo(OrderDetailResponse.Lookup.PENDING);

    doThrow(new BusinessException(ErrorCode.COOKING_SERVICE_UNAVAILABLE))
        .when(cookingClient)
        .getStatus(any());
    OrderDetailResponse r = service.getOrder(7L, 5L);
    assertThat(r.cooking().lookup()).isEqualTo(OrderDetailResponse.Lookup.UNAVAILABLE);
    assertThat(r.cooking().status()).isNull();
    assertThat(r.status()).isEqualTo(OrderStatus.PAID);

    doThrow(new BusinessException(ErrorCode.UPSTREAM_INVALID_RESPONSE))
        .when(cookingClient)
        .getStatus(any());
    assertThat(service.getOrder(7L, 5L).cooking().lookup())
        .isEqualTo(OrderDetailResponse.Lookup.UNAVAILABLE);
  }

  @Test
  void unpaid_failed_and_canceled_orders_do_not_call_cooking() {
    for (OrderStatus status :
        List.of(OrderStatus.CREATED, OrderStatus.FAILED, OrderStatus.CANCELED)) {
      when(txService.findDetail(7L, 5L)).thenReturn(Optional.of(detailWithStatus(status)));

      assertThat(service.getOrder(7L, 5L).cooking()).isNull();
    }
    verify(cookingClient, never()).getStatus(any());
  }
}
