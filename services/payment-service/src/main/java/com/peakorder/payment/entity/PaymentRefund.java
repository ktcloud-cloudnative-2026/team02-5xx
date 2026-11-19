package com.peakorder.payment.entity;

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
@Table(name = "payment_refunds")
public class PaymentRefund {

  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  @ManyToOne(fetch = FetchType.LAZY, optional = false)
  @JoinColumn(name = "payment_id", nullable = false)
  private Payment payment;

  @Column(nullable = false)
  private int amount;

  @Column(length = 100)
  private String reason;

  @Enumerated(EnumType.STRING)
  @Column(nullable = false, length = 20)
  private RefundStatus status;

  @Column(name = "requested_at", nullable = false)
  private OffsetDateTime requestedAt;

  @Column(name = "completed_at")
  private OffsetDateTime completedAt;

  protected PaymentRefund() {}

  /** 모의 환불은 즉시 완료된다. 결제 금액 전액을 환불한다. */
  public static PaymentRefund completed(Payment payment, String reason, OffsetDateTime now) {
    PaymentRefund r = new PaymentRefund();
    r.payment = payment;
    r.amount = payment.getAmount();
    r.reason = reason;
    r.status = RefundStatus.COMPLETED;
    r.requestedAt = now;
    r.completedAt = now;
    return r;
  }

  public Long getId() {
    return id;
  }

  public Payment getPayment() {
    return payment;
  }

  public int getAmount() {
    return amount;
  }

  public String getReason() {
    return reason;
  }

  public RefundStatus getStatus() {
    return status;
  }

  public OffsetDateTime getRequestedAt() {
    return requestedAt;
  }

  public OffsetDateTime getCompletedAt() {
    return completedAt;
  }
}
