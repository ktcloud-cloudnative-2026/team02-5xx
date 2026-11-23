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

  @Test
  void delete_records_deleted_at_and_unlinks_menu() {
    // 메뉴 연결을 풀어 두므로 메뉴 번호로 재고를 찾는 IN-01·II-01~04에서 자동으로 빠진다
    Inventory inventory = inventoryOf(10, 0);
    ReflectionTestUtils.setField(inventory, "menuId", 5L);

    inventory.delete();

    assertThat(inventory.isDeleted()).isTrue();
    assertThat(inventory.getMenuId()).isNull();
  }
}
