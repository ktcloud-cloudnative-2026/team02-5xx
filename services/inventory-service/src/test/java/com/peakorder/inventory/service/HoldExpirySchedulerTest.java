package com.peakorder.inventory.service;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.peakorder.inventory.entity.InventoryReservation;
import com.peakorder.inventory.repository.InventoryReservationRepository;
import java.time.OffsetDateTime;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

class HoldExpirySchedulerTest {

  private InventoryReservationRepository reservationRepository;
  private InventoryHoldService holdService;
  private HoldExpiryScheduler scheduler;

  @BeforeEach
  void setUp() {
    reservationRepository = mock(InventoryReservationRepository.class);
    holdService = mock(InventoryHoldService.class);
    scheduler = new HoldExpiryScheduler(reservationRepository, holdService);
  }

  private InventoryReservation overdueReservation(long id) {
    InventoryReservation reservation =
        new InventoryReservation(id, OffsetDateTime.now().minusMinutes(1));
    ReflectionTestUtils.setField(reservation, "id", id);
    return reservation;
  }

  @Test
  void expires_every_overdue_hold() {
    when(reservationRepository.findByStatusAndExpiresAtBefore(eq("RESERVED"), any()))
        .thenReturn(List.of(overdueReservation(1L), overdueReservation(2L)));

    scheduler.expireOverdueHolds();

    verify(holdService).expire(1L);
    verify(holdService).expire(2L);
  }

  @Test
  void keeps_going_when_one_fails() {
    when(reservationRepository.findByStatusAndExpiresAtBefore(eq("RESERVED"), any()))
        .thenReturn(List.of(overdueReservation(1L), overdueReservation(2L)));
    doThrow(new RuntimeException("boom")).when(holdService).expire(1L);

    scheduler.expireOverdueHolds();

    verify(holdService).expire(2L);
  }
}
