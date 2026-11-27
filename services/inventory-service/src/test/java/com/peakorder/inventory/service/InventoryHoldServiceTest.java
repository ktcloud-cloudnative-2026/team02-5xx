package com.peakorder.inventory.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.peakorder.inventory.dto.HoldRequest;
import com.peakorder.inventory.dto.HoldResponse;
import com.peakorder.inventory.dto.RestoreResponse;
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
import org.mockito.InOrder;
import org.slf4j.LoggerFactory;
import org.springframework.beans.BeanUtils;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

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

  private InventoryReservation activeReservation() {
    return new InventoryReservation(1L, OffsetDateTime.now().plusMinutes(5));
  }

  private InventoryReservation confirmedReservation() {
    InventoryReservation reservation = activeReservation();
    ReflectionTestUtils.setField(reservation, "id", 100L);
    reservation.confirm();
    return reservation;
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
    InventoryReservation existing = activeReservation();
    when(reservationRepository.findByOrderId(1L)).thenReturn(Optional.of(existing));

    HoldResponse response = service.hold(requestOf(1L, 10L, 3));

    assertThat(response.expiresAt()).isEqualTo(existing.getExpiresAt());
    verify(inventoryRepository, never()).findByMenuIdForUpdate(any());
  }

  @Test
  void hold_returns_hold_committed_by_concurrent_same_order_request() {
    // 첫 확인은 비어 있었지만, 잠금을 기다리는 사이 같은 주문의 다른 요청이 확보를 커밋했다
    Inventory inventory = inventoryOf(10, 0);
    InventoryReservation committed = activeReservation();
    ReflectionTestUtils.setField(committed, "id", 100L);
    when(reservationRepository.findByOrderId(1L))
        .thenReturn(Optional.empty())
        .thenReturn(Optional.of(committed));
    when(inventoryRepository.findByMenuIdForUpdate(10L)).thenReturn(Optional.of(inventory));

    HoldResponse response = service.hold(requestOf(1L, 10L, 3));

    assertThat(response.holdId()).isEqualTo(100L);
    assertThat(inventory.getReservedQty()).isZero();
    verify(reservationRepository, never()).save(any());
    verify(itemRepository, never()).save(any());

    InOrder order = inOrder(reservationRepository, inventoryRepository);
    order.verify(reservationRepository).findByOrderId(1L);
    order.verify(inventoryRepository).findByMenuIdForUpdate(10L);
    order.verify(reservationRepository).findByOrderId(1L);
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
    InventoryReservation reservation = activeReservation();
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
    InventoryReservation reservation = activeReservation();
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

  // ===== II-03 해제 =====

  @Test
  void release_frees_reserved_and_keeps_stock() {
    InventoryReservation reservation = activeReservation();
    Inventory inventory = inventoryOf(10, 3);
    when(reservationRepository.findByIdForUpdate(100L)).thenReturn(Optional.of(reservation));
    when(itemRepository.findByReservationId(100L))
        .thenReturn(List.of(new InventoryReservationItem(100L, 10L, 3)));
    when(inventoryRepository.findByMenuIdForUpdate(10L)).thenReturn(Optional.of(inventory));

    service.release(100L);

    assertThat(inventory.getStockQty()).isEqualTo(10);
    assertThat(inventory.getReservedQty()).isEqualTo(0);
    assertThat(reservation.getStatus()).isEqualTo("RELEASED");
  }

  @Test
  void release_does_nothing_when_already_released() {
    InventoryReservation reservation = activeReservation();
    reservation.release();
    when(reservationRepository.findByIdForUpdate(100L)).thenReturn(Optional.of(reservation));

    service.release(100L);

    verify(inventoryRepository, never()).findByMenuIdForUpdate(any());
  }

  @Test
  void release_throws_not_active_when_confirmed() {
    InventoryReservation reservation = activeReservation();
    reservation.confirm();
    when(reservationRepository.findByIdForUpdate(100L)).thenReturn(Optional.of(reservation));

    assertThatThrownBy(() -> service.release(100L))
        .isInstanceOf(BusinessException.class)
        .extracting("errorCode")
        .isEqualTo(ErrorCode.HOLD_NOT_ACTIVE);
    verify(inventoryRepository, never()).findByMenuIdForUpdate(any());
  }

  @Test
  void release_throws_not_found_when_no_hold() {
    when(reservationRepository.findByIdForUpdate(100L)).thenReturn(Optional.empty());

    assertThatThrownBy(() -> service.release(100L))
        .isInstanceOf(BusinessException.class)
        .extracting("errorCode")
        .isEqualTo(ErrorCode.HOLD_NOT_FOUND);
  }

  // ===== II-04 복원 =====

  @Test
  void restore_returns_stock_when_confirmed() {
    InventoryReservation reservation = confirmedReservation();
    Inventory inventory = inventoryOf(7, 0);
    when(reservationRepository.findByOrderIdForUpdate(1L)).thenReturn(Optional.of(reservation));
    when(itemRepository.findByReservationId(100L))
        .thenReturn(List.of(new InventoryReservationItem(100L, 10L, 3)));
    when(inventoryRepository.findByMenuIdForUpdate(10L)).thenReturn(Optional.of(inventory));

    RestoreResponse response = service.restore(1L);

    assertThat(inventory.getStockQty()).isEqualTo(10);
    assertThat(inventory.getReservedQty()).isEqualTo(0);
    assertThat(reservation.getStatus()).isEqualTo("RESTORED");
    assertThat(response.restored()).isTrue();
  }

  @Test
  void restore_does_nothing_when_already_restored() {
    InventoryReservation reservation = confirmedReservation();
    reservation.restore();
    when(reservationRepository.findByOrderIdForUpdate(1L)).thenReturn(Optional.of(reservation));

    RestoreResponse response = service.restore(1L);

    assertThat(response.restored()).isTrue();
    verify(inventoryRepository, never()).findByMenuIdForUpdate(any());
  }

  @Test
  void restore_throws_not_applicable_when_not_confirmed() {
    when(reservationRepository.findByOrderIdForUpdate(1L))
        .thenReturn(Optional.of(activeReservation()));

    assertThatThrownBy(() -> service.restore(1L))
        .isInstanceOf(BusinessException.class)
        .extracting("errorCode")
        .isEqualTo(ErrorCode.RESTORE_NOT_APPLICABLE);
    verify(inventoryRepository, never()).findByMenuIdForUpdate(any());
  }

  @Test
  void restore_throws_not_applicable_when_no_hold() {
    when(reservationRepository.findByOrderIdForUpdate(1L)).thenReturn(Optional.empty());

    assertThatThrownBy(() -> service.restore(1L))
        .isInstanceOf(BusinessException.class)
        .extracting("errorCode")
        .isEqualTo(ErrorCode.RESTORE_NOT_APPLICABLE);
  }

  // ===== 만료 =====

  @Test
  void expire_frees_reserved_when_overdue() {
    InventoryReservation reservation =
        new InventoryReservation(1L, OffsetDateTime.now().minusMinutes(1));
    Inventory inventory = inventoryOf(10, 3);
    when(reservationRepository.findByIdForUpdate(100L)).thenReturn(Optional.of(reservation));
    when(itemRepository.findByReservationId(100L))
        .thenReturn(List.of(new InventoryReservationItem(100L, 10L, 3)));
    when(inventoryRepository.findByMenuIdForUpdate(10L)).thenReturn(Optional.of(inventory));

    service.expire(100L);

    assertThat(inventory.getStockQty()).isEqualTo(10);
    assertThat(inventory.getReservedQty()).isEqualTo(0);
    assertThat(reservation.getStatus()).isEqualTo("EXPIRED");
  }

  @Test
  void expire_skips_when_already_confirmed() {
    InventoryReservation reservation =
        new InventoryReservation(1L, OffsetDateTime.now().minusMinutes(1));
    reservation.confirm();
    when(reservationRepository.findByIdForUpdate(100L)).thenReturn(Optional.of(reservation));

    service.expire(100L);

    assertThat(reservation.getStatus()).isEqualTo("CONFIRMED");
    verify(inventoryRepository, never()).findByMenuIdForUpdate(any());
  }

  @Test
  void expire_skips_when_not_yet_due() {
    InventoryReservation reservation = activeReservation();
    when(reservationRepository.findByIdForUpdate(100L)).thenReturn(Optional.of(reservation));

    service.expire(100L);

    assertThat(reservation.getStatus()).isEqualTo("RESERVED");
    verify(inventoryRepository, never()).findByMenuIdForUpdate(any());
  }

  // ===== 상태 변경 로그(#459): 실제로 바뀐 경우에만, 커밋 뒤에 =====

  private ListAppender<ILoggingEvent> captureLogs() {
    Logger logger = (Logger) LoggerFactory.getLogger(InventoryHoldService.class);
    ListAppender<ILoggingEvent> logs = new ListAppender<>();
    logs.start();
    logger.addAppender(logs);
    return logs;
  }

  private void stopCapturing(ListAppender<ILoggingEvent> logs) {
    ((Logger) LoggerFactory.getLogger(InventoryHoldService.class)).detachAppender(logs);
  }

  private List<String> messages(ListAppender<ILoggingEvent> logs) {
    return logs.list.stream().map(ILoggingEvent::getFormattedMessage).toList();
  }

  private void stubActiveHold(InventoryReservation reservation, Inventory inventory) {
    ReflectionTestUtils.setField(reservation, "id", 100L);
    when(reservationRepository.findByIdForUpdate(100L)).thenReturn(Optional.of(reservation));
    when(itemRepository.findByReservationId(100L))
        .thenReturn(List.of(new InventoryReservationItem(100L, 10L, 3)));
    when(inventoryRepository.findByMenuIdForUpdate(10L)).thenReturn(Optional.of(inventory));
  }

  @Test
  void hold_logs_order_hold_and_items_once() {
    ListAppender<ILoggingEvent> logs = captureLogs();
    try {
      when(reservationRepository.findByOrderId(1L)).thenReturn(Optional.empty());
      when(inventoryRepository.findByMenuIdForUpdate(10L))
          .thenReturn(Optional.of(inventoryOf(10, 0)));
      when(reservationRepository.save(any())).thenAnswer(call -> call.getArgument(0));

      service.hold(
          new HoldRequest(1L, List.of(new HoldRequest.Item(10L, 2), new HoldRequest.Item(10L, 1))));

      assertThat(messages(logs)).containsExactly("재고 확보 orderId=1 holdId=null items=10x3");
    } finally {
      stopCapturing(logs);
    }
  }

  @Test
  void hold_does_not_log_for_existing_or_rejected_requests() {
    ListAppender<ILoggingEvent> logs = captureLogs();
    try {
      when(reservationRepository.findByOrderId(1L)).thenReturn(Optional.of(activeReservation()));
      service.hold(requestOf(1L, 10L, 3));

      when(reservationRepository.findByOrderId(2L)).thenReturn(Optional.empty());
      when(inventoryRepository.findByMenuIdForUpdate(10L))
          .thenReturn(Optional.of(inventoryOf(2, 0)));
      assertThatThrownBy(() -> service.hold(requestOf(2L, 10L, 3)))
          .isInstanceOf(BusinessException.class);

      assertThat(logs.list).isEmpty();
    } finally {
      stopCapturing(logs);
    }
  }

  @Test
  void hold_logs_only_after_commit_and_not_on_rollback() {
    ListAppender<ILoggingEvent> logs = captureLogs();
    TransactionSynchronizationManager.initSynchronization();
    try {
      when(reservationRepository.findByOrderId(1L)).thenReturn(Optional.empty());
      when(inventoryRepository.findByMenuIdForUpdate(10L))
          .thenReturn(Optional.of(inventoryOf(10, 0)));
      when(reservationRepository.save(any())).thenAnswer(call -> call.getArgument(0));

      service.hold(requestOf(1L, 10L, 3));
      assertThat(logs.list).isEmpty();

      TransactionSynchronizationManager.getSynchronizations()
          .forEach(TransactionSynchronization::afterCommit);
      assertThat(messages(logs)).hasSize(1);
    } finally {
      TransactionSynchronizationManager.clearSynchronization();
      stopCapturing(logs);
    }

    ListAppender<ILoggingEvent> rolledBack = captureLogs();
    TransactionSynchronizationManager.initSynchronization();
    try {
      when(reservationRepository.findByOrderId(3L)).thenReturn(Optional.empty());
      service.hold(requestOf(3L, 10L, 3));
      // 롤백이면 afterCommit이 호출되지 않는다
      assertThat(rolledBack.list).isEmpty();
    } finally {
      TransactionSynchronizationManager.clearSynchronization();
      stopCapturing(rolledBack);
    }
  }

  @Test
  void confirm_logs_only_on_actual_transition() {
    ListAppender<ILoggingEvent> logs = captureLogs();
    try {
      InventoryReservation reservation = activeReservation();
      stubActiveHold(reservation, inventoryOf(10, 3));

      service.confirm(100L);
      service.confirm(100L); // 이미 CONFIRMED: 아무것도 바뀌지 않는다

      assertThat(messages(logs)).containsExactly("재고 확보 확정 orderId=1 holdId=100");
    } finally {
      stopCapturing(logs);
    }
  }

  @Test
  void confirm_does_not_log_when_rejected() {
    ListAppender<ILoggingEvent> logs = captureLogs();
    try {
      InventoryReservation reservation =
          new InventoryReservation(1L, OffsetDateTime.now().minusMinutes(1));
      when(reservationRepository.findByIdForUpdate(100L)).thenReturn(Optional.of(reservation));

      assertThatThrownBy(() -> service.confirm(100L)).isInstanceOf(BusinessException.class);

      assertThat(logs.list).isEmpty();
    } finally {
      stopCapturing(logs);
    }
  }

  @Test
  void release_logs_only_on_actual_transition() {
    ListAppender<ILoggingEvent> logs = captureLogs();
    try {
      InventoryReservation reservation = activeReservation();
      stubActiveHold(reservation, inventoryOf(10, 3));

      service.release(100L);
      service.release(100L); // 이미 RELEASED

      assertThat(messages(logs)).containsExactly("재고 확보 해제 orderId=1 holdId=100");
    } finally {
      stopCapturing(logs);
    }
  }

  @Test
  void restore_logs_only_on_actual_transition() {
    ListAppender<ILoggingEvent> logs = captureLogs();
    try {
      InventoryReservation reservation = confirmedReservation();
      when(reservationRepository.findByOrderIdForUpdate(1L)).thenReturn(Optional.of(reservation));
      when(itemRepository.findByReservationId(100L))
          .thenReturn(List.of(new InventoryReservationItem(100L, 10L, 3)));
      when(inventoryRepository.findByMenuIdForUpdate(10L))
          .thenReturn(Optional.of(inventoryOf(7, 0)));

      service.restore(1L);
      service.restore(1L); // 이미 RESTORED

      assertThat(messages(logs)).containsExactly("재고 복원 orderId=1 holdId=100");
    } finally {
      stopCapturing(logs);
    }
  }

  @Test
  void expire_logs_only_when_actually_expired() {
    ListAppender<ILoggingEvent> logs = captureLogs();
    try {
      InventoryReservation overdue =
          new InventoryReservation(1L, OffsetDateTime.now().minusMinutes(1));
      stubActiveHold(overdue, inventoryOf(10, 3));
      service.expire(100L);

      InventoryReservation notYet = activeReservation();
      ReflectionTestUtils.setField(notYet, "id", 101L);
      when(reservationRepository.findByIdForUpdate(101L)).thenReturn(Optional.of(notYet));
      service.expire(101L); // 아직 시간이 안 됐다

      assertThat(messages(logs)).containsExactly("재고 확보 만료 orderId=1 holdId=100");
    } finally {
      stopCapturing(logs);
    }
  }
}
