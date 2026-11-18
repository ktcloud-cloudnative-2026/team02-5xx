package com.peakorder.order.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import java.time.OffsetDateTime;

@Entity
@Table(name = "order_status_histories")
public class OrderStatusHistory {

  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  @ManyToOne(fetch = FetchType.LAZY, optional = false)
  @JoinColumn(name = "order_id", nullable = false)
  private Order order;

  @Enumerated(EnumType.STRING)
  @Column(name = "from_status", length = 20)
  private OrderStatus fromStatus;

  @Enumerated(EnumType.STRING)
  @Column(name = "to_status", nullable = false, length = 20)
  private OrderStatus toStatus;

  private String reason;

  @Column(name = "changed_at", nullable = false)
  private OffsetDateTime changedAt;

  protected OrderStatusHistory() {}

  OrderStatusHistory(
      Order order,
      OrderStatus fromStatus,
      OrderStatus toStatus,
      String reason,
      OffsetDateTime changedAt) {
    this.order = order;
    this.fromStatus = fromStatus;
    this.toStatus = toStatus;
    this.reason = reason;
    this.changedAt = changedAt;
  }

  public OrderStatus getFromStatus() {
    return fromStatus;
  }

  public OrderStatus getToStatus() {
    return toStatus;
  }

  public String getReason() {
    return reason;
  }

  public OffsetDateTime getChangedAt() {
    return changedAt;
  }
}
