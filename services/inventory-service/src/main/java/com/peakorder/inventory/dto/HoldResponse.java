package com.peakorder.inventory.dto;

import com.peakorder.inventory.entity.InventoryReservation;
import java.time.OffsetDateTime;

public record HoldResponse(Long holdId, OffsetDateTime expiresAt) {

  public static HoldResponse from(InventoryReservation reservation) {
    return new HoldResponse(reservation.getId(), reservation.getExpiresAt());
  }
}
