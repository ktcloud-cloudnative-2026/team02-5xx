package com.peakorder.inventory.service;

import com.peakorder.inventory.entity.InventoryReservation;
import com.peakorder.inventory.repository.InventoryReservationRepository;
import java.time.OffsetDateTime;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class HoldExpiryScheduler {

  private static final Logger log = LoggerFactory.getLogger(HoldExpiryScheduler.class);

  private final InventoryReservationRepository reservationRepository;
  private final InventoryHoldService holdService;

  public HoldExpiryScheduler(
      InventoryReservationRepository reservationRepository, InventoryHoldService holdService) {
    this.reservationRepository = reservationRepository;
    this.holdService = holdService;
  }

  @Scheduled(fixedDelayString = "${inventory.expiry-check-delay-ms:5000}")
  public void expireOverdueHolds() {
    List<InventoryReservation> overdue =
        reservationRepository.findByStatusAndExpiresAtBefore("RESERVED", OffsetDateTime.now());

    for (InventoryReservation reservation : overdue) {
      try {
        holdService.expire(reservation.getId());
      } catch (RuntimeException e) {
        log.warn("재고 확보 만료 처리 실패 holdId={}", reservation.getId(), e);
      }
    }
  }
}
