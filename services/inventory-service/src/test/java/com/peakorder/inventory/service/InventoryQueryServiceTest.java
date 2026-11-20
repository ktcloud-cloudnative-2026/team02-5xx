package com.peakorder.inventory.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.peakorder.inventory.dto.AvailabilityResponse;
import com.peakorder.inventory.entity.Inventory;
import com.peakorder.inventory.exception.BusinessException;
import com.peakorder.inventory.exception.ErrorCode;
import com.peakorder.inventory.repository.InventoryRepository;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

class InventoryQueryServiceTest {

  private InventoryRepository inventoryRepository;
  private InventoryQueryService service;

  @BeforeEach
  void setUp() {
    inventoryRepository = mock(InventoryRepository.class);
    service = new InventoryQueryService(inventoryRepository);
  }

  private Inventory linked(long menuId, int stockQty, int reservedQty) {
    Inventory inventory = new Inventory(stockQty, 2);
    ReflectionTestUtils.setField(inventory, "menuId", menuId);
    ReflectionTestUtils.setField(inventory, "reservedQty", reservedQty);
    return inventory;
  }

  @Test
  void orderable_when_stock_left_and_not_when_unlinked() {
    when(inventoryRepository.findByMenuIdIn(any())).thenReturn(List.of(linked(1L, 10, 3)));

    List<AvailabilityResponse> result = service.availability("1,2");

    assertThat(result)
        .containsExactly(
            new AvailabilityResponse(1L, true, 7), new AvailabilityResponse(2L, false, 0));
  }

  @Test
  void not_orderable_when_everything_is_reserved() {
    when(inventoryRepository.findByMenuIdIn(any())).thenReturn(List.of(linked(1L, 2, 2)));

    List<AvailabilityResponse> result = service.availability("1");

    assertThat(result).containsExactly(new AvailabilityResponse(1L, false, 0));
  }

  @Test
  void duplicate_ids_answer_once() {
    when(inventoryRepository.findByMenuIdIn(any())).thenReturn(List.of(linked(1L, 5, 0)));

    List<AvailabilityResponse> result = service.availability("1, 1");

    assertThat(result).hasSize(1);
  }

  @Test
  void rejects_blank_or_wrong_ids() {
    for (String bad : new String[] {null, "", "1,abc", "0"}) {
      assertThatThrownBy(() -> service.availability(bad))
          .isInstanceOf(BusinessException.class)
          .extracting("errorCode")
          .isEqualTo(ErrorCode.INVALID_REQUEST);
    }
  }
}
