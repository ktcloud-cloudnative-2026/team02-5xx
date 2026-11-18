package com.peakorder.inventory.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.OffsetDateTime;

@Entity
@Table(name = "inventory_reservations")
public class InventoryReservation {

  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  @Column(name = "order_id", nullable = false, unique = true)
  private Long orderId;

  @Column(nullable = false)
  private String status;

  @Column(name = "expires_at", nullable = false)
  private OffsetDateTime expiresAt;

  @Column(name = "created_at", nullable = false)
  private OffsetDateTime createdAt;

  @Column(name = "updated_at", nullable = false)
  private OffsetDateTime updatedAt;

  protected InventoryReservation() {}

  public InventoryReservation(Long orderId, OffsetDateTime expiresAt) {
    OffsetDateTime now = OffsetDateTime.now();
    this.orderId = orderId;
    this.status = "RESERVED";
    this.expiresAt = expiresAt;
    this.createdAt = now;
    this.updatedAt = now;
  }

  public Long getId() {
    return id;
  }

  public Long getOrderId() {
    return orderId;
  }

  public String getStatus() {
    return status;
  }

  public OffsetDateTime getExpiresAt() {
    return expiresAt;
  }

  public boolean isExpired(OffsetDateTime now) {
    return expiresAt.isBefore(now);
  }

  public void confirm() {
    this.status = "CONFIRMED";
    this.updatedAt = OffsetDateTime.now();
  }

  public void release() {
    this.status = "RELEASED";
    this.updatedAt = OffsetDateTime.now();
  }
}
