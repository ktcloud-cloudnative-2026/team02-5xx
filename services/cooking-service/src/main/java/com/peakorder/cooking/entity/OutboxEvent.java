package com.peakorder.cooking.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/** 발행할 이벤트(예: CookingCompleted). 상태 변경과 같은 트랜잭션에 저장한 뒤 별도로 발행한다. */
@Entity
@Table(name = "outbox_events")
public class OutboxEvent {

  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  @Column(name = "event_id", nullable = false, unique = true)
  private UUID eventId;

  @Column(name = "event_type", nullable = false, length = 50)
  private String eventType;

  @JdbcTypeCode(SqlTypes.JSON)
  @Column(name = "payload", nullable = false, columnDefinition = "jsonb")
  private String payload;

  @Enumerated(EnumType.STRING)
  @Column(name = "status", nullable = false, length = 20)
  private OutboxStatus status;

  @Column(name = "created_at", nullable = false)
  private Instant createdAt;

  @Column(name = "sent_at")
  private Instant sentAt;

  protected OutboxEvent() {}

  /**
   * @param payload JSON 문자열
   */
  public static OutboxEvent create(String eventType, String payload, Instant now) {
    OutboxEvent event = new OutboxEvent();
    event.eventId = UUID.randomUUID();
    event.eventType = eventType;
    event.payload = payload;
    event.status = OutboxStatus.PENDING;
    event.createdAt = now;
    return event;
  }

  public void markSent(Instant now) {
    this.status = OutboxStatus.SENT;
    this.sentAt = now;
  }

  public Long getId() {
    return id;
  }

  public UUID getEventId() {
    return eventId;
  }

  public String getEventType() {
    return eventType;
  }

  public String getPayload() {
    return payload;
  }

  public OutboxStatus getStatus() {
    return status;
  }

  public Instant getCreatedAt() {
    return createdAt;
  }

  public Instant getSentAt() {
    return sentAt;
  }
}
