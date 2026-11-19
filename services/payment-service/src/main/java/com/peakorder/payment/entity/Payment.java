package com.peakorder.payment.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.OffsetDateTime;

@Entity
@Table(name = "payments")
public class Payment {

  public static final String MOCK_CARD = "MOCK_CARD";

  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  @Column(name = "order_id", nullable = false)
  private Long orderId;

  @Column(name = "idempotency_key", nullable = false, length = 100)
  private String idempotencyKey;

  @Column(nullable = false)
  private int amount;

  @Column(nullable = false, length = 20)
  private String method;

  @Enumerated(EnumType.STRING)
  @Column(nullable = false, length = 20)
  private PaymentStatus status;

  @Column(name = "mock_tx_id", length = 50)
  private String mockTxId;

  @Column(name = "fail_reason", length = 100)
  private String failReason;

  @Column(name = "requested_at", nullable = false)
  private OffsetDateTime requestedAt;

  @Column(name = "approved_at")
  private OffsetDateTime approvedAt;

  @Column(name = "canceled_at")
  private OffsetDateTime canceledAt;

  protected Payment() {}

  private Payment(Long orderId, String idempotencyKey, int amount, OffsetDateTime now) {
    this.orderId = orderId;
    this.idempotencyKey = idempotencyKey;
    this.amount = amount;
    this.method = MOCK_CARD;
    this.requestedAt = now;
  }

  /** 모의 승인된 결제. */
  public static Payment approved(
      Long orderId, String idempotencyKey, int amount, String mockTxId, OffsetDateTime now) {
    Payment p = new Payment(orderId, idempotencyKey, amount, now);
    p.status = PaymentStatus.APPROVED;
    p.mockTxId = mockTxId;
    p.approvedAt = now;
    return p;
  }

  /** 모의 거절된 결제. 실패가 확정된 결제이며 다시 승인되지 않는다. */
  public static Payment failed(
      Long orderId, String idempotencyKey, int amount, String failReason, OffsetDateTime now) {
    Payment p = new Payment(orderId, idempotencyKey, amount, now);
    p.status = PaymentStatus.FAILED;
    p.failReason = failReason;
    return p;
  }

  /** 같은 요청의 재전송인지 확인한다. 키가 같은데 주문·금액이 다르면 다른 요청이다. */
  public boolean isSameRequest(Long orderId, int amount) {
    return this.orderId.equals(orderId) && this.amount == amount;
  }

  public void markRefunded(OffsetDateTime now) {
    if (status != PaymentStatus.APPROVED) {
      throw new IllegalStateException("승인된 결제만 환불할 수 있다: " + status);
    }
    this.status = PaymentStatus.REFUNDED;
    this.canceledAt = now;
  }

  public Long getId() {
    return id;
  }

  public Long getOrderId() {
    return orderId;
  }

  public String getIdempotencyKey() {
    return idempotencyKey;
  }

  public int getAmount() {
    return amount;
  }

  public String getMethod() {
    return method;
  }

  public PaymentStatus getStatus() {
    return status;
  }

  public String getMockTxId() {
    return mockTxId;
  }

  public String getFailReason() {
    return failReason;
  }

  public OffsetDateTime getRequestedAt() {
    return requestedAt;
  }

  public OffsetDateTime getApprovedAt() {
    return approvedAt;
  }

  public OffsetDateTime getCanceledAt() {
    return canceledAt;
  }
}
