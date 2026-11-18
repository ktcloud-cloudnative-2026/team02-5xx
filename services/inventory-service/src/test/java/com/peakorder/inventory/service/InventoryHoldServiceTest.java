package com.peakorder.inventory.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.peakorder.inventory.dto.HoldRequest;
import com.peakorder.inventory.dto.HoldResponse;
import com.peakorder.inventory.entity.Inventory;
import com.peakorder.inventory.entity.InventoryReservation;
import com.peakorder.inventory.entity.InventoryReservationItem;
import com.peakorder.inventory.exception.BusinessException;
import com.peakorder.inventory.exception.ErrorCode;
import com.peakorder.inventory.repository.InventoryRepository;
import com.peakorder.inventory.repository.InventoryReservationItemRepository;
import com.peakorder.inventory.repository.InventoryReservationRepository;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.BeanUtils;
import org.springframework.test.util.ReflectionTestUtils;

class InventoryHoldServiceTest {

  private InventoryRepository inventoryRepository;
  private InventoryReservationRepository reservationRepository;
  private InventoryReservationItemRepository itemRepository;
  private InventoryHoldService service;

  @BeforeEach
  void setUp() {
    inventoryRepository = mock(InventoryRepository.class);
    reservationRepository = mock(InventoryReservationRepository.class);
    itemRepository = mock(InventoryReservationItemRepository.class);
    service =
        new InventoryHoldService(
            inventoryRepository, reservationRepository, itemRepository, Duration.ofMinutes(5));
  }

  private Inventory inventoryOf(int stockQty, int reservedQty) {
    Inventory inventory = BeanUtils.instantiateClass(Inventory.class);
    ReflectionTestUtils.setField(inventory, "stockQty", stockQty);
    ReflectionTestUtils.setField(inventory, "reservedQty", reservedQty);
    return inventory;
  }

  private HoldRequest requestOf(long orderId, long menuId, int quantity) {
    return new HoldRequest(orderId, List.of(new HoldRequest.Item(menuId, quantity)));
  }

  // ===== II-01 임시 확보 =====

  @Test
  void hold_reserves_stock_when_enough() {
    Inventory inventory = inventoryOf(10, 0);
    when(reservationRepository.findByOrderId(1L)).thenReturn(Optional.empty());
    when(inventoryRepository.findByMenuIdForUpdate(10L)).thenReturn(Optional.of(inventory));
    when(reservationRepository.save(any())).thenAnswer(call -> call.getArgument(0));

    service.hold(requestOf(1L, 10L, 3));

    assertThat(inventory.getAvailableQty()).isEqualTo(7);
    verify(itemRepository).save(any());
  }

  @Test
  void hold_returns_existing_when_same_order() {
    InventoryReservation existing =
        new InventoryReservation(1L, OffsetDateTime.now().plusMinutes(5));
    when(reservationRepository.findByOrderId(1L)).thenReturn(Optional.of(existing));

    HoldResponse response = service.hold(requestOf(1L, 10L, 3));

    assertThat(response.expiresAt()).isEqualTo(existing.getExpiresAt());
    verify(inventoryRepository, never()).findByMenuIdForUpdate(any());
  }

  @Test
  void hold_throws_not_linked_when_no_inventory() {
    when(reservationRepository.findByOrderId(1L)).thenReturn(Optional.empty());
    when(inventoryRepository.findByMenuIdForUpdate(10L)).thenReturn(Optional.empty());

    assertThatThrownBy(() -> service.hold(requestOf(1L, 10L, 3)))
        .isInstanceOf(BusinessException.class)
        .extracting("errorCode")
        .isEqualTo(ErrorCode.STOCK_NOT_LINKED);
    verify(reservationRepository, never()).save(any());
  }

  @Test
  void hold_throws_insufficient_when_not_enough() {
    when(reservationRepository.findByOrderId(1L)).thenReturn(Optional.empty());
    when(inventoryRepository.findByMenuIdForUpdate(10L)).thenReturn(Optional.of(inventoryOf(2, 0)));

    assertThatThrownBy(() -> service.hold(requestOf(1L, 10L, 3)))
        .isInstanceOf(BusinessException.class)
        .extracting("errorCode")
        .isEqualTo(ErrorCode.INSUFFICIENT_STOCK);
    verify(reservationRepository, never()).save(any());
  }

  // ===== II-02 확정 =====

  @Test
  void confirm_moves_reserved_out_of_stock() {
    InventoryReservation reservation =
        new InventoryReservation(1L, OffsetDateTime.now().plusMinutes(5));
    Inventory inventory = inventoryOf(10, 3);
    when(reservationRepository.findByIdForUpdate(100L)).thenReturn(Optional.of(reservation));
    when(itemRepository.findByReservationId(100L))
        .thenReturn(List.of(new InventoryReservationItem(100L, 10L, 3)));
    when(inventoryRepository.findByMenuIdForUpdate(10L)).thenReturn(Optional.of(inventory));

    service.confirm(100L);

    assertThat(inventory.getStockQty()).isEqualTo(7);
    assertThat(inventory.getReservedQty()).isEqualTo(0);
    assertThat(reservation.getStatus()).isEqualTo("CONFIRMED");
  }

  @Test
  void confirm_does_nothing_when_already_confirmed() {
    InventoryReservation reservation =
        new InventoryReservation(1L, OffsetDateTime.now().plusMinutes(5));
    reservation.confirm();
    when(reservationRepository.findByIdForUpdate(100L)).thenReturn(Optional.of(reservation));

    service.confirm(100L);

    verify(inventoryRepository, never()).findByMenuIdForUpdate(any());
  }

  @Test
  void confirm_throws_not_found_when_no_hold() {
    when(reservationRepository.findByIdForUpdate(100L)).thenReturn(Optional.empty());

    assertThatThrownBy(() -> service.confirm(100L))
        .isInstanceOf(BusinessException.class)
        .extracting("errorCode")
        .isEqualTo(ErrorCode.HOLD_NOT_FOUND);
  }

  @Test
  void confirm_throws_not_active_when_expired() {
    InventoryReservation reservation =
        new InventoryReservation(1L, OffsetDateTime.now().minusMinutes(1));
    when(reservationRepository.findByIdForUpdate(100L)).thenReturn(Optional.of(reservation));

    assertThatThrownBy(() -> service.confirm(100L))
        .isInstanceOf(BusinessException.class)
        .extracting("errorCode")
        .isEqualTo(ErrorCode.HOLD_NOT_ACTIVE);
    verify(inventoryRepository, never()).findByMenuIdForUpdate(any());
  }
}
