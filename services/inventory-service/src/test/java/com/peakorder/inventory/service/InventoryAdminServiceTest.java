package com.peakorder.inventory.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.peakorder.inventory.dto.StockItemCreateRequest;
import com.peakorder.inventory.dto.StockItemResponse;
import com.peakorder.inventory.dto.StockRestockRequest;
import com.peakorder.inventory.entity.Inventory;
import com.peakorder.inventory.exception.BusinessException;
import com.peakorder.inventory.exception.ErrorCode;
import com.peakorder.inventory.repository.InventoryRepository;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

class InventoryAdminServiceTest {

  private InventoryRepository inventoryRepository;
  private InventoryAdminService service;

  @BeforeEach
  void setUp() {
    inventoryRepository = mock(InventoryRepository.class);
    service = new InventoryAdminService(inventoryRepository);
  }

  private Inventory stockItem(long id, int stockQty, int reservedQty) {
    Inventory inventory = new Inventory(stockQty, 2);
    ReflectionTestUtils.setField(inventory, "id", id);
    ReflectionTestUtils.setField(inventory, "reservedQty", reservedQty);
    return inventory;
  }

  // ===== IN-03 등록 =====

  @Test
  void create_saves_new_stock_item_without_menu() {
    when(inventoryRepository.save(any())).thenAnswer(call -> call.getArgument(0));

    StockItemResponse response = service.create(new StockItemCreateRequest(10, 2));

    assertThat(response.stockQty()).isEqualTo(10);
    assertThat(response.reservedQty()).isEqualTo(0);
    assertThat(response.menuId()).isNull();
  }

  // ===== IN-04 추가 =====

  @Test
  void restock_adds_quantity() {
    Inventory inventory = stockItem(1L, 3, 1);
    when(inventoryRepository.findByIdForUpdate(1L)).thenReturn(Optional.of(inventory));

    StockItemResponse response = service.restock(1L, new StockRestockRequest(10));

    assertThat(response.stockQty()).isEqualTo(13);
    assertThat(response.availableQty()).isEqualTo(12);
  }

  @Test
  void restock_throws_not_found_when_no_item() {
    when(inventoryRepository.findByIdForUpdate(99L)).thenReturn(Optional.empty());

    assertThatThrownBy(() -> service.restock(99L, new StockRestockRequest(10)))
        .isInstanceOf(BusinessException.class)
        .extracting("errorCode")
        .isEqualTo(ErrorCode.INVENTORY_NOT_FOUND);
  }
}
