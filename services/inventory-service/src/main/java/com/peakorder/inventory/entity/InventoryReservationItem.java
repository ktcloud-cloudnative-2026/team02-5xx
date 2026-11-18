package com.peakorder.inventory.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

@Entity
@Table(name = "inventory_reservation_items")
public class InventoryReservationItem {

  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  @Column(name = "reservation_id", nullable = false)
  private Long reservationId;

  @Column(name = "menu_id", nullable = false)
  private Long menuId;

  @Column(nullable = false)
  private int quantity;

  protected InventoryReservationItem() {}

  public InventoryReservationItem(Long reservationId, Long menuId, int quantity) {
    this.reservationId = reservationId;
    this.menuId = menuId;
    this.quantity = quantity;
  }

  public Long getId() {
    return id;
  }

  public Long getReservationId() {
    return reservationId;
  }

  public Long getMenuId() {
    return menuId;
  }

  public int getQuantity() {
    return quantity;
  }
}
