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
}
