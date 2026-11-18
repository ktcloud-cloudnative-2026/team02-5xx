package com.peakorder.inventory.entity;

import com.peakorder.inventory.exception.BusinessException;
import com.peakorder.inventory.exception.ErrorCode;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.OffsetDateTime;

@Entity
@Table(name = "inventories")
public class Inventory {

  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  @Column(name = "menu_id", unique = true)
  private Long menuId;

  @Column(name = "stock_qty", nullable = false)
  private int stockQty;

  @Column(name = "reserved_qty", nullable = false)
  private int reservedQty;

  @Column(name = "low_stock_threshold", nullable = false)
  private int lowStockThreshold;

  @Column(nullable = false)
  private long version;

  @Column(name = "updated_at", nullable = false)
  private OffsetDateTime updatedAt;

  protected Inventory() {}

  public Long getId() {
    return id;
  }

  public Long getMenuId() {
    return menuId;
  }

  public int getStockQty() {
    return stockQty;
  }

  public int getReservedQty() {
    return reservedQty;
  }

  public int getAvailableQty() {
    return stockQty - reservedQty;
  }

  public void reserve(int quantity) {
    if (getAvailableQty() < quantity) {
      throw new BusinessException(ErrorCode.INSUFFICIENT_STOCK);
    }
    reservedQty += quantity;
    updatedAt = OffsetDateTime.now();
  }

  public void confirm(int quantity) {
    stockQty -= quantity;
    reservedQty -= quantity;
    updatedAt = OffsetDateTime.now();
  }
}
