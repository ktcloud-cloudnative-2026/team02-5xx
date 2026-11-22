package com.peakorder.order.entity;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.OffsetDateTime;
import java.util.List;
import org.junit.jupiter.api.Test;

class OrderTest {

  private final OffsetDateTime now = OffsetDateTime.parse("2026-11-13T10:00:00+09:00");

  @Test
  void temporary_order_starts_created_without_order_no_and_records_history() {
    Order order = Order.createTemporary(7L, now);

    assertThat(order.getStatus()).isEqualTo(OrderStatus.CREATED);
    assertThat(order.getOrderNo()).isNull();
    assertThat(order.getOrderedAt()).isEqualTo(now);
    assertThat(order.getHistories()).hasSize(1);
    assertThat(order.getHistories().get(0).getFromStatus()).isNull();
    assertThat(order.getHistories().get(0).getToStatus()).isEqualTo(OrderStatus.CREATED);
  }

  @Test
  void line_amount_is_unit_price_plus_options_times_quantity_and_total_sums_lines() {
    Order order = Order.createTemporary(7L, now);
    order.addItem(1L, "아메리카노", 3000, 2, List.of(new OrderItemOption(10L, "샷 추가", 500)));
    order.addItem(2L, "라떼", 4000, 1, List.of());

    assertThat(order.getItems().get(0).getLineAmount()).isEqualTo(7000);
    assertThat(order.getItems().get(1).getLineAmount()).isEqualTo(4000);
    assertThat(order.getTotalAmount()).isEqualTo(11000);
    assertThat(order.getItems().get(0).getOptions()).hasSize(1);
  }

  @Test
  void amount_overflow_is_rejected() {
    Order order = Order.createTemporary(7L, now);

    assertThatThrownBy(() -> order.addItem(1L, "x", Integer.MAX_VALUE, 2, List.of()))
        .isInstanceOf(ArithmeticException.class);
  }

  @Test
  void mark_failed_changes_status_and_adds_history() {
    Order order = Order.createTemporary(7L, now);
    OffsetDateTime later = now.plusSeconds(1);

    order.markFailed("OUT_OF_STOCK", later);

    assertThat(order.getStatus()).isEqualTo(OrderStatus.FAILED);
    assertThat(order.getFailReason()).isEqualTo("OUT_OF_STOCK");
    assertThat(order.getHistories()).hasSize(2);
    assertThat(order.getHistories().get(1).getFromStatus()).isEqualTo(OrderStatus.CREATED);
    assertThat(order.getHistories().get(1).getToStatus()).isEqualTo(OrderStatus.FAILED);
  }

  @Test
  void mark_confirmed_issues_order_no_and_moves_to_paid() {
    Order order = Order.createTemporary(7L, now);
    OffsetDateTime later = now.plusSeconds(30);

    order.markConfirmed("261113-0001", 9L, later);

    assertThat(order.getStatus()).isEqualTo(OrderStatus.PAID);
    assertThat(order.getOrderNo()).isEqualTo("261113-0001");
    assertThat(order.getPaymentId()).isEqualTo(9L);
    assertThat(order.getPaidAt()).isEqualTo(later);
    assertThat(order.getHistories().get(1).getFromStatus()).isEqualTo(OrderStatus.CREATED);
    assertThat(order.getHistories().get(1).getToStatus()).isEqualTo(OrderStatus.PAID);
  }

  @Test
  void payment_requested_time_keeps_the_first_value() {
    Order order = Order.createTemporary(7L, now);

    order.markPaymentRequested(now.plusSeconds(10));
    order.markPaymentRequested(now.plusSeconds(99));

    assertThat(order.getPaymentRequestedAt()).isEqualTo(now.plusSeconds(10));
    assertThat(order.getStatus()).isEqualTo(OrderStatus.CREATED);
  }

  @Test
  void payment_id_is_recorded_once_and_does_not_change_the_status() {
    Order order = Order.createTemporary(7L, now);

    order.recordPaymentId(9L, now.plusSeconds(10));
    order.recordPaymentId(10L, now.plusSeconds(20));

    assertThat(order.getPaymentId()).isEqualTo(9L);
    assertThat(order.getStatus()).isEqualTo(OrderStatus.CREATED);
    assertThat(order.getHistories()).hasSize(1);
  }

  @Test
  void created_order_can_be_canceled_with_reason_time_and_history() {
    Order order = Order.createTemporary(7L, now);

    order.markCanceled("CUSTOMER_CANCEL", now.plusSeconds(5));

    assertThat(order.getStatus()).isEqualTo(OrderStatus.CANCELED);
    assertThat(order.getCancelReason()).isEqualTo("CUSTOMER_CANCEL");
    assertThat(order.getCanceledAt()).isEqualTo(now.plusSeconds(5));
    assertThat(order.getHistories().get(1).getFromStatus()).isEqualTo(OrderStatus.CREATED);
    assertThat(order.getHistories().get(1).getToStatus()).isEqualTo(OrderStatus.CANCELED);
  }

  @Test
  void confirmed_order_can_be_canceled_and_repeating_it_changes_nothing() {
    Order order = Order.createTemporary(7L, now);
    order.markConfirmed("261113-0001", 9L, now.plusSeconds(1));

    order.markCanceled("CUSTOMER_CANCEL", now.plusSeconds(2));
    order.markCanceled("CUSTOMER_CANCEL", now.plusSeconds(3));

    assertThat(order.getStatus()).isEqualTo(OrderStatus.CANCELED);
    assertThat(order.getCanceledAt()).isEqualTo(now.plusSeconds(2));
    assertThat(order.getHistories()).hasSize(3);
  }

  @Test
  void completed_or_failed_orders_cannot_be_canceled() {
    Order completed = Order.createTemporary(7L, now);
    completed.markConfirmed("261113-0001", 9L, now);
    completed.markCompleted(now, now);
    Order failed = Order.createTemporary(7L, now);
    failed.markFailed("PAYMENT_FAILED", now);

    assertThatThrownBy(() -> completed.markCanceled("CUSTOMER_CANCEL", now))
        .isInstanceOf(IllegalStateException.class);
    assertThatThrownBy(() -> failed.markCanceled("CUSTOMER_CANCEL", now))
        .isInstanceOf(IllegalStateException.class);
  }

  @Test
  void follow_up_times_keep_the_first_value() {
    Order order = Order.createTemporary(7L, now);
    order.markConfirmed("261113-0001", 9L, now);
    order.markCanceled("CUSTOMER_CANCEL", now);

    order.markStockRestored(now.plusSeconds(10));
    order.markStockRestored(now.plusSeconds(99));
    order.markRefunded(now.plusSeconds(20));
    order.markRefunded(now.plusSeconds(99));

    assertThat(order.getStockRestoredAt()).isEqualTo(now.plusSeconds(10));
    assertThat(order.getRefundedAt()).isEqualTo(now.plusSeconds(20));
    assertThat(order.getStatus()).isEqualTo(OrderStatus.CANCELED);
  }

  @Test
  void cancel_request_time_keeps_the_first_value_and_can_be_cleared() {
    Order order = Order.createTemporary(7L, now);
    order.markConfirmed("261113-0001", 9L, now);

    order.markCancelRequested(now.plusSeconds(10));
    order.markCancelRequested(now.plusSeconds(99));
    assertThat(order.getCancelRequestedAt()).isEqualTo(now.plusSeconds(10));
    assertThat(order.getStatus()).isEqualTo(OrderStatus.PAID);

    order.clearCancelRequested(now.plusSeconds(20));
    assertThat(order.getCancelRequestedAt()).isNull();
  }

  @Test
  void follow_up_failures_are_counted_and_delay_the_next_attempt() {
    Order order = Order.createTemporary(7L, now);
    order.markConfirmed("261113-0001", 9L, now);
    order.markCanceled("CUSTOMER_CANCEL", now);

    boolean manual =
        order.recordCancelFollowUpFailure(now.plusSeconds(10), 3, java.time.Duration.ofSeconds(30));

    assertThat(manual).isFalse();
    assertThat(order.getCancelFollowUpAttempts()).isEqualTo(1);
    assertThat(order.getCancelFollowUpNextAttemptAt()).isEqualTo(now.plusSeconds(40));
    assertThat(order.getCancelFollowUpManualAt()).isNull();
  }

  @Test
  void reaching_the_attempt_limit_marks_the_order_for_a_manual_check_and_stops_retrying() {
    Order order = Order.createTemporary(7L, now);
    order.markConfirmed("261113-0001", 9L, now);
    order.markCanceled("CUSTOMER_CANCEL", now);

    order.recordCancelFollowUpFailure(now.plusSeconds(1), 3, java.time.Duration.ofSeconds(30));
    order.recordCancelFollowUpFailure(now.plusSeconds(2), 3, java.time.Duration.ofSeconds(60));
    boolean manual =
        order.recordCancelFollowUpFailure(now.plusSeconds(3), 3, java.time.Duration.ofSeconds(120));

    assertThat(manual).isTrue();
    assertThat(order.getCancelFollowUpAttempts()).isEqualTo(3);
    assertThat(order.getCancelFollowUpManualAt()).isEqualTo(now.plusSeconds(3));
    assertThat(order.getCancelFollowUpManualReason()).isEqualTo("RETRY_LIMIT_EXCEEDED");
    assertThat(order.getCancelFollowUpNextAttemptAt()).isNull();
  }

  @Test
  void the_first_manual_mark_keeps_its_time_and_reason() {
    Order order = Order.createTemporary(7L, now);
    order.markConfirmed("261113-0001", 9L, now);
    order.markCanceled("CUSTOMER_CANCEL", now);

    assertThat(order.markCancelFollowUpManual("REFUND_NOT_REFUNDABLE", now.plusSeconds(5)))
        .isTrue();
    assertThat(order.markCancelFollowUpManual("OTHER", now.plusSeconds(9))).isFalse();

    assertThat(order.getCancelFollowUpManualAt()).isEqualTo(now.plusSeconds(5));
    assertThat(order.getCancelFollowUpManualReason()).isEqualTo("REFUND_NOT_REFUNDABLE");
    assertThat(order.getStatus()).isEqualTo(OrderStatus.CANCELED);
  }

  @Test
  void confirmed_states_are_paid_and_after() {
    assertThat(OrderStatus.CREATED.isConfirmed()).isFalse();
    assertThat(OrderStatus.FAILED.isConfirmed()).isFalse();
    assertThat(OrderStatus.CANCELED.isConfirmed()).isFalse();
    assertThat(OrderStatus.PAID.isConfirmed()).isTrue();
    assertThat(OrderStatus.COMPLETED.isConfirmed()).isTrue();
  }

  // ---- 수동 확인 필요 판단 (관리자 조회·지표와 같은 기준) ----

  private Order canceledPaidOrder() {
    Order order = Order.createTemporary(7L, now);
    order.addItem(1L, "아메리카노", 3000, 1, List.of());
    order.markConfirmed("261120-0001", 55L, now);
    order.markCanceled("CUSTOMER_CANCEL", now);
    return order;
  }

  @Test
  void a_canceled_order_with_unfinished_follow_ups_marked_manual_needs_review() {
    Order order = canceledPaidOrder();
    assertThat(order.needsManualReview()).isFalse(); // 표시 전

    order.markCancelFollowUpManual("REFUND_NOT_REFUNDABLE", now);

    assertThat(order.needsManualReview()).isTrue();
  }

  @Test
  void the_manual_mark_stops_counting_once_both_follow_ups_are_finished() {
    Order order = canceledPaidOrder();
    order.markCancelFollowUpManual("REFUND_NOT_REFUNDABLE", now);
    order.markStockRestored(now);
    assertThat(order.needsManualReview()).isTrue(); // 환불이 아직 안 끝남

    order.markRefunded(now);

    assertThat(order.needsManualReview()).isFalse();
  }

  @Test
  void an_order_that_is_not_canceled_never_needs_manual_review() {
    Order order = Order.createTemporary(7L, now);
    order.addItem(1L, "아메리카노", 3000, 1, List.of());
    order.markConfirmed("261120-0002", 56L, now);

    assertThat(order.needsManualReview()).isFalse();
  }
}
