package com.peakorder.order.entity;

import jakarta.persistence.CascadeType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.OneToMany;
import jakarta.persistence.Table;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;

@Entity
@Table(name = "orders")
public class Order {

  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  @Column(name = "order_no")
  private String orderNo;

  @Column(name = "user_id", nullable = false)
  private Long userId;

  @Enumerated(EnumType.STRING)
  @Column(nullable = false, length = 20)
  private OrderStatus status;

  @Column(name = "total_amount", nullable = false)
  private int totalAmount;

  @Column(name = "expected_wait_sec")
  private Integer expectedWaitSec;

  @Column(name = "cancel_reason")
  private String cancelReason;

  @Column(name = "fail_reason")
  private String failReason;

  @Column(name = "ordered_at", nullable = false)
  private OffsetDateTime orderedAt;

  @Column(name = "paid_at")
  private OffsetDateTime paidAt;

  @Column(name = "canceled_at")
  private OffsetDateTime canceledAt;

  @Column(name = "completed_at")
  private OffsetDateTime completedAt;

  @Column(name = "updated_at", nullable = false)
  private OffsetDateTime updatedAt;

  @Column(name = "hold_id")
  private Long holdId;

  @Column(name = "hold_expires_at")
  private OffsetDateTime holdExpiresAt;

  @OneToMany(mappedBy = "order", cascade = CascadeType.ALL, orphanRemoval = true)
  private List<OrderItem> items = new ArrayList<>();

  @OneToMany(mappedBy = "order", cascade = CascadeType.ALL, orphanRemoval = true)
  private List<OrderStatusHistory> histories = new ArrayList<>();

  protected Order() {}

  /** 임시 주문(CREATED). 주문번호는 결제·재고 확정 후 발급하므로 NULL이다. */
  public static Order createTemporary(Long userId, OffsetDateTime now) {
    Order order = new Order();
    order.userId = userId;
    order.status = OrderStatus.CREATED;
    order.orderedAt = now;
    order.updatedAt = now;
    order.histories.add(new OrderStatusHistory(order, null, OrderStatus.CREATED, null, now));
    return order;
  }

  public OrderItem addItem(
      Long menuId, String menuName, int unitPrice, int quantity, List<OrderItemOption> options) {
    OrderItem item = new OrderItem(this, menuId, menuName, unitPrice, quantity, options);
    items.add(item);
    totalAmount = Math.addExact(totalAmount, item.getLineAmount());
    return item;
  }

  public void markHeld(Long holdId, OffsetDateTime holdExpiresAt, OffsetDateTime now) {
    this.holdId = holdId;
    this.holdExpiresAt = holdExpiresAt;
    this.updatedAt = now;
  }

  public void markFailed(String reason, OffsetDateTime now) {
    changeStatus(OrderStatus.FAILED, reason, now);
    this.failReason = reason;
  }

  public void changeStatus(OrderStatus to, String reason, OffsetDateTime now) {
    histories.add(new OrderStatusHistory(this, this.status, to, reason, now));
    this.status = to;
    this.updatedAt = now;
  }

  public Long getId() {
    return id;
  }

  public String getOrderNo() {
    return orderNo;
  }

  public Long getUserId() {
    return userId;
  }

  public OrderStatus getStatus() {
    return status;
  }

  public int getTotalAmount() {
    return totalAmount;
  }

  public Integer getExpectedWaitSec() {
    return expectedWaitSec;
  }

  public String getCancelReason() {
    return cancelReason;
  }

  public String getFailReason() {
    return failReason;
  }

  public OffsetDateTime getOrderedAt() {
    return orderedAt;
  }

  public OffsetDateTime getPaidAt() {
    return paidAt;
  }

  public OffsetDateTime getCanceledAt() {
    return canceledAt;
  }

  public OffsetDateTime getCompletedAt() {
    return completedAt;
  }

  public OffsetDateTime getUpdatedAt() {
    return updatedAt;
  }

  public Long getHoldId() {
    return holdId;
  }

  public OffsetDateTime getHoldExpiresAt() {
    return holdExpiresAt;
  }

  public List<OrderItem> getItems() {
    return items;
  }

  public List<OrderStatusHistory> getHistories() {
    return histories;
  }
}
