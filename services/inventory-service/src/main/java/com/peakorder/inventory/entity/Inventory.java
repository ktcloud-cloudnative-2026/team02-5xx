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

  @Column(name = "deleted_at")
  private OffsetDateTime deletedAt;

  protected Inventory() {}

  public Inventory(int stockQty, int lowStockThreshold) {
    this.stockQty = stockQty;
    this.reservedQty = 0;
    this.lowStockThreshold = lowStockThreshold;
    this.updatedAt = OffsetDateTime.now();
  }

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

  public int getLowStockThreshold() {
    return lowStockThreshold;
  }

  public int getAvailableQty() {
    return stockQty - reservedQty;
  }

  public boolean isDeleted() {
    return deletedAt != null;
  }

  public boolean isLowStock() {
    return getAvailableQty() <= lowStockThreshold;
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

  public void release(int quantity) {
    reservedQty -= quantity;
    updatedAt = OffsetDateTime.now();
  }

  public void restore(int quantity) {
    stockQty += quantity;
    updatedAt = OffsetDateTime.now();
  }

  public void addStock(int quantity) {
    stockQty += quantity;
    updatedAt = OffsetDateTime.now();
  }

  public void linkMenu(Long menuId) {
    this.menuId = menuId;
    updatedAt = OffsetDateTime.now();
  }

  /**
   * IN-06 논리 삭제. 메뉴 연결도 푼다: menu_id가 UNIQUE라 그 메뉴를 다른 재고에 다시 연결할 수 있고, 메뉴 번호로 재고를 찾는
   * IN-01·II-01~04에서 자동으로 빠진다.
   */
  public void delete() {
    OffsetDateTime now = OffsetDateTime.now();
    deletedAt = now;
    menuId = null;
    updatedAt = now;
  }
}
