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
  void confirmed_states_are_paid_and_after() {
    assertThat(OrderStatus.CREATED.isConfirmed()).isFalse();
    assertThat(OrderStatus.FAILED.isConfirmed()).isFalse();
    assertThat(OrderStatus.CANCELED.isConfirmed()).isFalse();
    assertThat(OrderStatus.PAID.isConfirmed()).isTrue();
    assertThat(OrderStatus.COMPLETED.isConfirmed()).isTrue();
  }
}
