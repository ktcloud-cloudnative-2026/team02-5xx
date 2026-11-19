package com.peakorder.inventory.entity;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.peakorder.inventory.exception.BusinessException;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

class InventoryTest {

  private Inventory inventoryOf(int stockQty, int reservedQty) {
    Inventory inventory = new Inventory();
    ReflectionTestUtils.setField(inventory, "stockQty", stockQty);
    ReflectionTestUtils.setField(inventory, "reservedQty", reservedQty);
    return inventory;
  }

  @Test
  void reserve_increases_reserved_when_enough() {
    Inventory inventory = inventoryOf(10, 3); // 가용 7

    inventory.reserve(3);

    assertThat(inventory.getAvailableQty()).isEqualTo(4);
  }

  @Test
  void reserve_throws_when_insufficient() {
    Inventory inventory = inventoryOf(10, 3);

    assertThatThrownBy(() -> inventory.reserve(8)).isInstanceOf(BusinessException.class);
  }
}
