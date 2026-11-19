package com.peakorder.order.entity;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.OffsetDateTime;
import org.junit.jupiter.api.Test;

class StoreOperationTest {

  private final OffsetDateTime t0 = OffsetDateTime.parse("2026-11-19T10:00:00+09:00");
  private final OffsetDateTime t1 = t0.plusMinutes(5);

  @Test
  void orders_are_accepted_only_when_open_and_accepting() {
    assertThat(new StoreOperation(true, true, t0).canAcceptOrders()).isTrue();
    assertThat(new StoreOperation(true, false, t0).canAcceptOrders()).isFalse();
    assertThat(new StoreOperation(false, true, t0).canAcceptOrders()).isFalse();
    assertThat(new StoreOperation(false, false, t0).canAcceptOrders()).isFalse();
  }

  @Test
  void update_changes_only_the_fields_that_were_sent() {
    StoreOperation store = new StoreOperation(false, false, t0);

    assertThat(store.update(true, null, t1)).isTrue();

    assertThat(store.isOpen()).isTrue();
    assertThat(store.isAcceptingOrders()).isFalse();
    assertThat(store.getUpdatedAt()).isEqualTo(t1);
  }

  @Test
  void update_with_the_same_values_changes_nothing_and_keeps_the_time() {
    StoreOperation store = new StoreOperation(true, true, t0);

    assertThat(store.update(true, true, t1)).isFalse();
    assertThat(store.update(null, null, t1)).isFalse();

    assertThat(store.getUpdatedAt()).isEqualTo(t0);
  }

  @Test
  void both_fields_can_be_changed_at_once() {
    StoreOperation store = new StoreOperation(true, true, t0);

    assertThat(store.update(false, false, t1)).isTrue();

    assertThat(store.isOpen()).isFalse();
    assertThat(store.isAcceptingOrders()).isFalse();
    assertThat(store.getUpdatedAt()).isEqualTo(t1);
  }
}
