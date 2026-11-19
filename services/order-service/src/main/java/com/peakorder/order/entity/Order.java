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
import jakarta.persistence.OrderBy;
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

  @Column(name = "payment_id")
  private Long paymentId;

  @Column(name = "payment_requested_at")
  private OffsetDateTime paymentRequestedAt;

  @Column(name = "cancel_requested_at")
  private OffsetDateTime cancelRequestedAt;

  @Column(name = "cancel_follow_up_attempts", nullable = false)
  private int cancelFollowUpAttempts;

  @Column(name = "cancel_follow_up_next_attempt_at")
  private OffsetDateTime cancelFollowUpNextAttemptAt;

  @Column(name = "cancel_follow_up_manual_at")
  private OffsetDateTime cancelFollowUpManualAt;

  @Column(name = "cancel_follow_up_manual_reason")
  private String cancelFollowUpManualReason;

  @Column(name = "stock_restored_at")
  private OffsetDateTime stockRestoredAt;

  @Column(name = "refunded_at")
  private OffsetDateTime refundedAt;

  /** 결제 처리 독점 만료 시각. 갱신은 {@code OrderRepository}의 조건부 UPDATE로만 한다. */
  @Column(name = "pay_lock_until")
  private OffsetDateTime payLockUntil;

  /** 결제 처리 독점을 잡은 요청의 토큰. */
  @Column(name = "pay_lock_token")
  private java.util.UUID payLockToken;

  @OneToMany(mappedBy = "order", cascade = CascadeType.ALL, orphanRemoval = true)
  @OrderBy("id ASC")
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

  /**
   * 결제 요청 직전에 기록한다. 이후에는 결제가 이미 됐을 수 있어, 응답을 받지 못한 채 재고 확보가 만료돼도 결과를 확인하기 전에는 주문을 종료하지 않는다. 처음 기록한
   * 시각을 유지한다.
   */
  public void markPaymentRequested(OffsetDateTime now) {
    if (this.paymentRequestedAt == null) {
      this.paymentRequestedAt = now;
      this.updatedAt = now;
    }
  }

  /** 결제 성공 직후 결제 ID를 남긴다. 이후 확정이 실패해도 환불·수동 확인에 쓸 수 있다. 이미 있으면 바꾸지 않는다. */
  public void recordPaymentId(Long paymentId, OffsetDateTime now) {
    if (this.paymentId == null) {
      this.paymentId = paymentId;
      this.updatedAt = now;
    }
  }

  /** 결제·재고 확정 완료: 주문번호를 발급하고 PAID로 변경한다. */
  public void markConfirmed(String orderNo, Long paymentId, OffsetDateTime now) {
    changeStatus(OrderStatus.PAID, null, now);
    this.orderNo = orderNo;
    this.paymentId = paymentId;
    this.paidAt = now;
  }

  /**
   * 조리 완료 반영(CookingCompleted). 확정된 주문(PAID·WAITING·COOKING)만 COMPLETED로 바꾼다. 이미 완료된 주문이면 아무것도 하지
   * 않고, 확정되지 않았거나 취소된 주문에 완료 이벤트가 오면 데이터 불일치이므로 예외로 알린다.
   */
  public void markCompleted(OffsetDateTime completedAt, OffsetDateTime now) {
    if (status == OrderStatus.COMPLETED) {
      return;
    }
    if (!status.isConfirmed()) {
      throw new IllegalStateException("조리 완료를 반영할 수 없는 주문 상태입니다: " + status);
    }
    changeStatus(OrderStatus.COMPLETED, null, now);
    this.completedAt = completedAt != null ? completedAt : now;
  }

  /**
   * 주문 취소. 결제 전(CREATED)이거나 확정된 주문(PAID·WAITING·COOKING)만 취소할 수 있다. 이미 취소된 주문이면 아무것도 바꾸지 않는다(멱등).
   * 취소 후속 처리(재고 복원·환불)는 {@link #markStockRestored}·{@link #markRefunded}로 따로 기록한다.
   */
  public void markCanceled(String reason, OffsetDateTime now) {
    if (status == OrderStatus.CANCELED) {
      return;
    }
    if (status != OrderStatus.CREATED && !status.isConfirmed()) {
      throw new IllegalStateException("취소할 수 없는 주문 상태입니다: " + status);
    }
    if (status == OrderStatus.COMPLETED) {
      throw new IllegalStateException("조리가 끝난 주문은 취소할 수 없습니다.");
    }
    changeStatus(OrderStatus.CANCELED, reason, now);
    this.cancelReason = reason;
    this.canceledAt = now;
  }

  /**
   * 확정된 주문의 취소를 Cooking에 요청하기 직전에 남긴다. Cooking 응답을 모른 채 값이 남아 있으면 나중에 CI-03을 다시 호출해 결과를 확정한다. 처음
   * 기록한 시각을 유지한다.
   */
  public void markCancelRequested(OffsetDateTime now) {
    if (this.cancelRequestedAt == null) {
      this.cancelRequestedAt = now;
      this.updatedAt = now;
    }
  }

  /** Cooking이 취소를 거절해 취소 요청이 더 이상 유효하지 않을 때 지운다. */
  public void clearCancelRequested(OffsetDateTime now) {
    if (this.cancelRequestedAt != null) {
      this.cancelRequestedAt = null;
      this.updatedAt = now;
    }
  }

  /**
   * 취소 후속 처리가 한 번 실패했음을 기록한다. 실패 횟수를 늘리고, 상한에 닿았으면 수동 확인 필요로 표시하며(이후 자동 재시도 안 함), 아니면 다음 시도 시각을
   * 정한다.
   *
   * @return 이번 실패로 수동 확인 필요가 된 경우 true
   */
  public boolean recordCancelFollowUpFailure(
      OffsetDateTime now, int maxAttempts, java.time.Duration nextDelay) {
    this.cancelFollowUpAttempts++;
    this.updatedAt = now;
    if (this.cancelFollowUpAttempts >= maxAttempts) {
      return markCancelFollowUpManual("RETRY_LIMIT_EXCEEDED", now);
    }
    this.cancelFollowUpNextAttemptAt = now.plus(nextDelay);
    return false;
  }

  /** 사람이 확인해야 하는 주문으로 표시한다. 처음 표시한 시각과 이유를 유지하며, 새로 표시했으면 true를 돌려준다. */
  public boolean markCancelFollowUpManual(String reason, OffsetDateTime now) {
    if (this.cancelFollowUpManualAt != null) {
      return false;
    }
    this.cancelFollowUpManualAt = now;
    this.cancelFollowUpManualReason = reason;
    this.cancelFollowUpNextAttemptAt = null;
    this.updatedAt = now;
    return true;
  }

  /** 취소로 재고 복원을 끝낸 시각을 남긴다. 처음 기록한 값을 유지한다. */
  public void markStockRestored(OffsetDateTime now) {
    if (this.stockRestoredAt == null) {
      this.stockRestoredAt = now;
      this.updatedAt = now;
    }
  }

  /** 취소로 환불을 끝낸 시각을 남긴다. 처음 기록한 값을 유지한다. */
  public void markRefunded(OffsetDateTime now) {
    if (this.refundedAt == null) {
      this.refundedAt = now;
      this.updatedAt = now;
    }
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

  public Long getPaymentId() {
    return paymentId;
  }

  public int getCancelFollowUpAttempts() {
    return cancelFollowUpAttempts;
  }

  public OffsetDateTime getCancelFollowUpNextAttemptAt() {
    return cancelFollowUpNextAttemptAt;
  }

  public OffsetDateTime getCancelFollowUpManualAt() {
    return cancelFollowUpManualAt;
  }

  public String getCancelFollowUpManualReason() {
    return cancelFollowUpManualReason;
  }

  public OffsetDateTime getCancelRequestedAt() {
    return cancelRequestedAt;
  }

  public OffsetDateTime getStockRestoredAt() {
    return stockRestoredAt;
  }

  public OffsetDateTime getRefundedAt() {
    return refundedAt;
  }

  public java.util.UUID getPayLockToken() {
    return payLockToken;
  }

  public OffsetDateTime getPaymentRequestedAt() {
    return paymentRequestedAt;
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
