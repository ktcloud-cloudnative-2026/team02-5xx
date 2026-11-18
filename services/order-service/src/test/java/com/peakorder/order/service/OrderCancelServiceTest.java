package com.peakorder.order.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.peakorder.order.client.CookingClient;
import com.peakorder.order.client.CookingClient.CancelResult;
import com.peakorder.order.client.InventoryClient;
import com.peakorder.order.client.InventoryClient.HoldRelease;
import com.peakorder.order.client.InventoryClient.RestoreResult;
import com.peakorder.order.client.PaymentClient;
import com.peakorder.order.dto.OrderDetailResponse;
import com.peakorder.order.entity.OrderStatus;
import com.peakorder.order.exception.BusinessException;
import com.peakorder.order.exception.ErrorCode;
import com.peakorder.order.service.OrderTxService.CancelTarget;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;

class OrderCancelServiceTest {

  private static final UUID LOCK = UUID.fromString("00000000-0000-0000-0000-0000000000a1");
  private final OffsetDateTime now = OffsetDateTime.parse("2026-11-18T10:00:00+09:00");

  private OrderTxService txService;
  private CookingClient cookingClient;
  private InventoryClient inventoryClient;
  private PaymentClient paymentClient;
  private OrderCancelService service;

  @BeforeEach
  void setUp() {
    txService = mock(OrderTxService.class);
    cookingClient = mock(CookingClient.class);
    inventoryClient = mock(InventoryClient.class);
    paymentClient = mock(PaymentClient.class);
    service = new OrderCancelService(txService, cookingClient, inventoryClient, paymentClient);
    when(txService.tryAcquireCancelLock(100L)).thenReturn(Optional.of(LOCK));
    when(txService.renewPayLock(any(), any())).thenReturn(true);
    when(txService.markCanceled(any(), any(), any())).thenReturn(true);
    when(txService.markStockRestored(any(), any())).thenReturn(true);
    when(txService.markRefunded(any(), any())).thenReturn(true);
    when(inventoryClient.releaseHold(any())).thenReturn(HoldRelease.RELEASED);
    when(inventoryClient.restore(any())).thenReturn(RestoreResult.RESTORED);
    when(cookingClient.cancel(any())).thenReturn(CancelResult.CANCELED);
  }

  private CancelTarget target(OrderStatus status) {
    return target(status, 55L, null, null, null);
  }

  private CancelTarget target(
      OrderStatus status,
      Long holdId,
      OffsetDateTime paymentRequestedAt,
      OffsetDateTime stockRestoredAt,
      OffsetDateTime refundedAt) {
    boolean confirmed = status != OrderStatus.CREATED && status != OrderStatus.FAILED;
    return new CancelTarget(
        100L,
        status,
        holdId,
        confirmed ? "261118-0001" : null,
        confirmed ? 9L : null,
        paymentRequestedAt,
        stockRestoredAt,
        refundedAt,
        mock(OrderDetailResponse.class));
  }

  private void reads(CancelTarget first, CancelTarget... next) {
    when(txService.findCancelTarget(7L, 100L)).thenReturn(first, next);
  }

  private ErrorCode errorOf(Runnable call) {
    try {
      call.run();
    } catch (BusinessException e) {
      return e.errorCode();
    }
    return null;
  }

  // ---- 취소할 수 없는 경우·멱등 ----

  @Test
  void someone_elses_order_is_not_found_and_nothing_is_called() {
    when(txService.findCancelTarget(7L, 100L))
        .thenThrow(new BusinessException(ErrorCode.ORDER_NOT_FOUND));

    assertThat(errorOf(() -> service.cancelOrder(7L, 100L))).isEqualTo(ErrorCode.ORDER_NOT_FOUND);

    verify(txService, never()).tryAcquireCancelLock(any());
    verify(cookingClient, never()).cancel(any());
  }

  @Test
  void completed_and_failed_orders_are_rejected_without_taking_the_lock() {
    for (OrderStatus status : List.of(OrderStatus.COMPLETED, OrderStatus.FAILED)) {
      reads(target(status));

      assertThat(errorOf(() -> service.cancelOrder(7L, 100L)))
          .isEqualTo(ErrorCode.ORDER_NOT_CANCELABLE);
    }
    verify(txService, never()).tryAcquireCancelLock(any());
    verify(cookingClient, never()).cancel(any());
  }

  @Test
  void canceling_an_already_canceled_order_returns_it_without_any_external_call() {
    CancelTarget done = target(OrderStatus.CANCELED, 55L, null, now, now); // 복원·환불까지 끝남
    reads(done);

    assertThat(service.cancelOrder(7L, 100L)).isSameAs(done.detail());

    verify(txService, never()).tryAcquireCancelLock(any());
    verify(cookingClient, never()).cancel(any());
    verify(inventoryClient, never()).restore(any());
    verify(paymentClient, never()).refund(any());
  }

  @Test
  void a_request_that_cannot_take_the_lock_reports_processing_or_the_finished_result() {
    when(txService.tryAcquireCancelLock(100L)).thenReturn(Optional.empty());
    reads(target(OrderStatus.PAID), target(OrderStatus.PAID));
    assertThat(errorOf(() -> service.cancelOrder(7L, 100L)))
        .isEqualTo(ErrorCode.ORDER_PAY_IN_PROGRESS);

    CancelTarget done = target(OrderStatus.CANCELED, 55L, null, now, now);
    reads(target(OrderStatus.PAID), done);
    assertThat(service.cancelOrder(7L, 100L)).isSameAs(done.detail());

    verify(cookingClient, never()).cancel(any());
  }

  // ---- 결제 전(CREATED) 취소 ----

  @Test
  void created_order_releases_the_hold_and_is_canceled_without_refund_or_cooking() {
    CancelTarget created = target(OrderStatus.CREATED);
    reads(created, created);
    when(txService.findCancelTargetById(100L)).thenReturn(created);

    service.cancelOrder(7L, 100L);

    InOrder order = inOrder(txService, inventoryClient);
    order.verify(txService).renewPayLock(100L, LOCK);
    order.verify(inventoryClient).releaseHold(55L);
    order.verify(txService).markCanceled(100L, LOCK, "CUSTOMER_CANCEL");
    order.verify(txService).releasePayLock(100L, LOCK);
    verify(cookingClient, never()).cancel(any());
    verify(inventoryClient, never()).restore(any());
    verify(paymentClient, never()).refund(any());
  }

  @Test
  void created_order_without_a_hold_is_canceled_without_calling_inventory() {
    CancelTarget created = target(OrderStatus.CREATED, null, null, null, null);
    reads(created, created);
    when(txService.findCancelTargetById(100L)).thenReturn(created);

    service.cancelOrder(7L, 100L);

    verify(inventoryClient, never()).releaseHold(any());
    verify(txService).markCanceled(100L, LOCK, "CUSTOMER_CANCEL");
  }

  @Test
  void created_order_with_a_payment_request_is_not_canceled_because_it_may_be_paid() {
    CancelTarget maybePaid = target(OrderStatus.CREATED, 55L, now, null, null);
    reads(maybePaid, maybePaid);

    assertThat(errorOf(() -> service.cancelOrder(7L, 100L)))
        .isEqualTo(ErrorCode.ORDER_PAYMENT_PENDING);

    verify(inventoryClient, never()).releaseHold(any());
    verify(txService, never()).markCanceled(any(), any(), any());
    verify(txService).releasePayLock(100L, LOCK);
  }

  @Test
  void created_order_whose_hold_is_already_confirmed_is_not_canceled_automatically() {
    CancelTarget created = target(OrderStatus.CREATED);
    reads(created, created);
    when(inventoryClient.releaseHold(55L)).thenReturn(HoldRelease.ALREADY_CONFIRMED);

    assertThat(errorOf(() -> service.cancelOrder(7L, 100L)))
        .isEqualTo(ErrorCode.ORDER_NOT_CANCELABLE);

    verify(txService, never()).markCanceled(any(), any(), any());
  }

  @Test
  void created_order_stays_when_the_hold_release_result_is_unknown() {
    CancelTarget created = target(OrderStatus.CREATED);
    reads(created, created);
    when(inventoryClient.releaseHold(55L))
        .thenThrow(new BusinessException(ErrorCode.INVENTORY_SERVICE_UNAVAILABLE));

    assertThat(errorOf(() -> service.cancelOrder(7L, 100L)))
        .isEqualTo(ErrorCode.INVENTORY_SERVICE_UNAVAILABLE);

    verify(txService, never()).markCanceled(any(), any(), any());
    verify(txService).releasePayLock(100L, LOCK);
  }

  // ---- 확정된 주문 취소 ----

  @Test
  void confirmed_order_is_canceled_after_cooking_agrees_then_stock_and_payment_are_returned() {
    CancelTarget paid = target(OrderStatus.PAID);
    CancelTarget canceled = target(OrderStatus.CANCELED); // 복원·환불 전
    reads(paid, paid);
    when(txService.findCancelTargetById(100L)).thenReturn(canceled);

    service.cancelOrder(7L, 100L);

    InOrder order = inOrder(txService, cookingClient, inventoryClient, paymentClient);
    order.verify(cookingClient).cancel(100L);
    order.verify(txService).markCanceled(100L, LOCK, "CUSTOMER_CANCEL");
    order.verify(inventoryClient).restore(100L);
    order.verify(txService).markStockRestored(100L, LOCK);
    order.verify(paymentClient).refund(9L);
    order.verify(txService).markRefunded(100L, LOCK);
    order.verify(txService).releasePayLock(100L, LOCK);
  }

  @Test
  void cooking_refusals_cancel_nothing_and_return_their_reason() {
    CancelTarget paid = target(OrderStatus.PAID);
    reads(paid, paid);

    when(cookingClient.cancel(100L)).thenReturn(CancelResult.ALREADY_STARTED);
    assertThat(errorOf(() -> service.cancelOrder(7L, 100L)))
        .isEqualTo(ErrorCode.COOKING_ALREADY_STARTED);

    when(cookingClient.cancel(100L)).thenReturn(CancelResult.ALREADY_DONE);
    assertThat(errorOf(() -> service.cancelOrder(7L, 100L)))
        .isEqualTo(ErrorCode.COOKING_ALREADY_DONE);

    when(cookingClient.cancel(100L)).thenReturn(CancelResult.TICKET_NOT_FOUND);
    assertThat(errorOf(() -> service.cancelOrder(7L, 100L)))
        .isEqualTo(ErrorCode.COOKING_ORDER_PENDING);

    verify(txService, never()).markCanceled(any(), any(), any());
    verify(inventoryClient, never()).restore(any());
    verify(paymentClient, never()).refund(any());
  }

  @Test
  void unknown_cooking_answer_keeps_the_order_and_reports_503() {
    CancelTarget paid = target(OrderStatus.PAID);
    reads(paid, paid);
    when(cookingClient.cancel(100L))
        .thenThrow(new BusinessException(ErrorCode.COOKING_SERVICE_UNAVAILABLE));

    assertThat(errorOf(() -> service.cancelOrder(7L, 100L)))
        .isEqualTo(ErrorCode.COOKING_SERVICE_UNAVAILABLE);

    verify(txService, never()).markCanceled(any(), any(), any());
    verify(txService).releasePayLock(100L, LOCK);
  }

  @Test
  void cancel_is_not_saved_when_the_lock_was_lost_so_follow_ups_do_not_run() {
    CancelTarget paid = target(OrderStatus.PAID);
    reads(paid, paid);
    when(txService.markCanceled(any(), any(), any())).thenReturn(false);

    assertThat(errorOf(() -> service.cancelOrder(7L, 100L)))
        .isEqualTo(ErrorCode.ORDER_PAY_IN_PROGRESS);

    verify(inventoryClient, never()).restore(any());
    verify(paymentClient, never()).refund(any());
  }

  @Test
  void a_request_that_lost_the_lock_does_not_call_cooking() {
    CancelTarget paid = target(OrderStatus.PAID);
    reads(paid, paid);
    when(txService.renewPayLock(any(), any())).thenReturn(false);

    assertThat(errorOf(() -> service.cancelOrder(7L, 100L)))
        .isEqualTo(ErrorCode.ORDER_PAY_IN_PROGRESS);

    verify(cookingClient, never()).cancel(any());
    verify(txService, never()).markCanceled(any(), any(), any());
  }

  // ---- 후속 처리 실패·재시도 ----

  @Test
  void stock_restore_failure_does_not_stop_the_refund_and_is_left_for_retry() {
    CancelTarget paid = target(OrderStatus.PAID);
    CancelTarget canceled = target(OrderStatus.CANCELED);
    reads(paid, paid);
    when(txService.findCancelTargetById(100L)).thenReturn(canceled);
    when(inventoryClient.restore(100L))
        .thenThrow(new BusinessException(ErrorCode.INVENTORY_SERVICE_UNAVAILABLE));

    service.cancelOrder(7L, 100L); // 주문은 CANCELED로 응답

    verify(txService, never()).markStockRestored(any(), any());
    verify(paymentClient).refund(9L);
    verify(txService).markRefunded(100L, LOCK);
  }

  @Test
  void refund_failure_is_left_for_retry_and_the_stock_step_is_still_recorded() {
    CancelTarget paid = target(OrderStatus.PAID);
    CancelTarget canceled = target(OrderStatus.CANCELED);
    reads(paid, paid);
    when(txService.findCancelTargetById(100L)).thenReturn(canceled);
    doThrow(new BusinessException(ErrorCode.PAYMENT_SERVICE_UNAVAILABLE))
        .when(paymentClient)
        .refund(9L);

    service.cancelOrder(7L, 100L);

    verify(txService).markStockRestored(100L, LOCK);
    verify(txService, never()).markRefunded(any(), any());
  }

  @Test
  void restore_that_is_not_applicable_is_not_recorded_as_done() {
    CancelTarget paid = target(OrderStatus.PAID);
    CancelTarget canceled = target(OrderStatus.CANCELED);
    reads(paid, paid);
    when(txService.findCancelTargetById(100L)).thenReturn(canceled);
    when(inventoryClient.restore(100L)).thenReturn(RestoreResult.NOT_APPLICABLE);

    service.cancelOrder(7L, 100L);

    verify(txService, never()).markStockRestored(any(), any());
  }

  @Test
  void calling_cancel_again_finishes_only_the_steps_that_are_left() {
    // 재고 복원은 끝났고 환불만 남은 CANCELED 주문
    CancelTarget refundLeft = target(OrderStatus.CANCELED, 55L, null, now, null);
    reads(refundLeft, refundLeft);
    when(txService.findCancelTargetById(100L)).thenReturn(refundLeft);

    service.cancelOrder(7L, 100L);

    verify(cookingClient, never()).cancel(any());
    verify(inventoryClient, never()).restore(any());
    verify(paymentClient).refund(9L);
    verify(txService).markRefunded(100L, LOCK);
  }

  @Test
  void follow_ups_stop_when_the_lock_is_lost_before_the_refund() {
    CancelTarget canceled = target(OrderStatus.CANCELED);
    reads(canceled, canceled);
    when(txService.findCancelTargetById(100L)).thenReturn(canceled);
    when(txService.renewPayLock(any(), any())).thenReturn(true, false);

    service.cancelOrder(7L, 100L);

    verify(inventoryClient).restore(100L);
    verify(paymentClient, never()).refund(any());
    verify(txService, never()).markRefunded(any(), any());
  }

  @Test
  void the_lock_is_released_even_when_an_unexpected_error_happens() {
    CancelTarget paid = target(OrderStatus.PAID);
    reads(paid, paid);
    when(cookingClient.cancel(100L)).thenThrow(new IllegalStateException("boom"));

    assertThat(org.assertj.core.api.Assertions.catchThrowable(() -> service.cancelOrder(7L, 100L)))
        .isInstanceOf(IllegalStateException.class);

    verify(txService).releasePayLock(100L, LOCK);
  }

  // ---- 스케줄러가 부르는 재시도 ----

  @Test
  void retry_finishes_orders_with_remaining_steps_and_skips_those_being_processed() {
    when(txService.findCancelFollowUpIds(anyInt(), anyInt())).thenReturn(List.of(100L, 101L));
    when(txService.tryAcquireCancelLock(101L)).thenReturn(Optional.empty());
    CancelTarget left = target(OrderStatus.CANCELED);
    CancelTarget done = target(OrderStatus.CANCELED, 55L, null, now, now);
    when(txService.findCancelTargetById(100L)).thenReturn(left, left, done);

    int completed = service.retryPendingFollowUps(10, 20);

    assertThat(completed).isEqualTo(1);
    verify(inventoryClient).restore(100L);
    verify(paymentClient).refund(9L);
    verify(txService, never()).findCancelTargetById(101L);
  }

  @Test
  void retry_continues_with_the_next_order_when_one_fails_unexpectedly() {
    when(txService.findCancelFollowUpIds(anyInt(), anyInt())).thenReturn(List.of(100L, 102L));
    when(txService.tryAcquireCancelLock(102L)).thenReturn(Optional.of(LOCK));
    when(txService.findCancelTargetById(100L)).thenThrow(new IllegalStateException("db"));
    CancelTarget left = target(OrderStatus.CANCELED);
    CancelTarget done = target(OrderStatus.CANCELED, 55L, null, now, now);
    when(txService.findCancelTargetById(102L)).thenReturn(left, left, done);

    int completed = service.retryPendingFollowUps(10, 20);

    assertThat(completed).isEqualTo(1);
    verify(txService).releasePayLock(100L, LOCK);
    verify(txService).releasePayLock(102L, LOCK);
  }
}
