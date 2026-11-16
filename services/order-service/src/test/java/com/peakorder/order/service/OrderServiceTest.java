package com.peakorder.order.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.peakorder.order.client.InventoryClient;
import com.peakorder.order.client.InventoryClient.HoldLine;
import com.peakorder.order.client.InventoryClient.StockHold;
import com.peakorder.order.client.MenuClient;
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
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;

class OrderServiceTest {

  private final OffsetDateTime now = OffsetDateTime.parse("2026-11-13T10:00:00+09:00");

  private OrderRepository orderRepository;
  private StoreOperationRepository storeRepository;
  private OrderTxService txService;
  private MenuClient menuClient;
  private InventoryClient inventoryClient;
  private PaymentClient paymentClient;
  private OrderService service;

  @BeforeEach
  void setUp() {
    orderRepository = mock(OrderRepository.class);
    storeRepository = mock(StoreOperationRepository.class);
    txService = mock(OrderTxService.class);
    menuClient = mock(MenuClient.class);
    inventoryClient = mock(InventoryClient.class);
    paymentClient = mock(PaymentClient.class);
    service =
        new OrderService(
            orderRepository,
            storeRepository,
            txService,
            menuClient,
            inventoryClient,
            paymentClient,
            Clock.fixed(now.toInstant(), ZoneId.of("Asia/Seoul")));
    when(storeRepository.findById(StoreOperation.SINGLE_STORE_ID))
        .thenReturn(Optional.of(new StoreOperation(true, true, now)));
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

    service.createOrder(7L, req);

    @SuppressWarnings("unchecked")
    ArgumentCaptor<List<HoldLine>> holdLines = ArgumentCaptor.forClass(List.class);
    verify(inventoryClient).hold(eq(100L), holdLines.capture());
    assertThat(holdLines.getValue()).containsExactly(new HoldLine(1L, 5));
  }

  @Test
  void detail_of_another_users_order_is_not_found() {
    when(orderRepository.findByIdAndUserId(5L, 7L)).thenReturn(Optional.empty());

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
    return new PaymentTarget(
        100L, status, 11000, holdId, holdExpiresAt, mock(OrderDetailResponse.class));
  }

  private PaymentTarget payable() {
    return target(OrderStatus.CREATED, 55L, now.plusMinutes(3));
  }

  @Test
  void pay_success_charges_confirms_stock_then_confirms_order() {
    when(txService.findPaymentTarget(7L, 100L)).thenReturn(payable());
    when(paymentClient.pay(100L, 11000, "order-100")).thenReturn(new PaymentResult(9L, "SUCCESS"));
    OrderDetailResponse confirmed = mock(OrderDetailResponse.class);
    when(txService.confirmOrder(100L, 9L)).thenReturn(confirmed);

    OrderDetailResponse actual = service.payOrder(7L, 100L);

    assertThat(actual).isSameAs(confirmed);
    org.mockito.InOrder order =
        org.mockito.Mockito.inOrder(paymentClient, inventoryClient, txService);
    order.verify(paymentClient).pay(100L, 11000, "order-100");
    order.verify(inventoryClient).confirm(55L);
    order.verify(txService).confirmOrder(100L, 9L);
    verify(txService, never()).markFailed(any(), any());
  }

  @Test
  void pay_on_already_confirmed_order_returns_current_state_without_charging_again() {
    PaymentTarget paid = target(OrderStatus.PAID, 55L, now.plusMinutes(3));
    when(txService.findPaymentTarget(7L, 100L)).thenReturn(paid);

    OrderDetailResponse actual = service.payOrder(7L, 100L);

    assertThat(actual).isSameAs(paid.detail());
    verify(paymentClient, never()).pay(any(), org.mockito.ArgumentMatchers.anyInt(), any());
    verify(txService, never()).confirmOrder(any(), any());
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
    verify(txService).markFailed(100L, "HOLD_EXPIRED");
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
    verify(txService).markFailed(100L, "PAYMENT_FAILED");
    verify(inventoryClient).release(55L);
    verify(inventoryClient, never()).confirm(any());
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
    verify(txService).markFailed(100L, "PAYMENT_FAILED");
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
    verify(txService, never()).markFailed(any(), any());
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
    verify(txService).markFailed(100L, "STOCK_CONFIRM_FAILED");
    verify(txService, never()).confirmOrder(any(), any());
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
    verify(txService).markFailed(100L, "STOCK_CONFIRM_FAILED_REFUND_NEEDED");
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
    verify(txService, never()).markFailed(any(), any());
  }
}
