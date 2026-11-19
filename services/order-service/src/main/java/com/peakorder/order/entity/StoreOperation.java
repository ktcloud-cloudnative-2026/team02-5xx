package com.peakorder.order.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.OffsetDateTime;

/** 단일 매장의 영업·주문 접수 상태. 행은 항상 id = 1 한 건이다. */
@Entity
@Table(name = "store_operations")
public class StoreOperation {

  public static final long SINGLE_STORE_ID = 1L;

  @Id private Long id;

  @Column(name = "is_open", nullable = false)
  private boolean open;

  @Column(name = "accepting_orders", nullable = false)
  private boolean acceptingOrders;

  @Column(name = "updated_at", nullable = false)
  private OffsetDateTime updatedAt;

  protected StoreOperation() {}

  public StoreOperation(boolean open, boolean acceptingOrders, OffsetDateTime updatedAt) {
    this.id = SINGLE_STORE_ID;
    this.open = open;
    this.acceptingOrders = acceptingOrders;
    this.updatedAt = updatedAt;
  }

  public boolean canAcceptOrders() {
    return open && acceptingOrders;
  }

  /** 보낸 항목만 바꾼다(null은 그대로 둔다). 값이 실제로 바뀐 경우에만 변경 시각을 갱신하고 true를 돌려준다. */
  public boolean update(Boolean newOpen, Boolean newAcceptingOrders, OffsetDateTime now) {
    boolean changed = false;
    if (newOpen != null && newOpen != this.open) {
      this.open = newOpen;
      changed = true;
    }
    if (newAcceptingOrders != null && newAcceptingOrders != this.acceptingOrders) {
      this.acceptingOrders = newAcceptingOrders;
      changed = true;
    }
    if (changed) {
      this.updatedAt = now;
    }
    return changed;
  }

  public boolean isOpen() {
    return open;
  }

  public boolean isAcceptingOrders() {
    return acceptingOrders;
  }

  public OffsetDateTime getUpdatedAt() {
    return updatedAt;
  }
}
