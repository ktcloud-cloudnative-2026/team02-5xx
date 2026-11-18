package com.peakorder.cooking.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

/**
 * 처리 완료한 수신 이벤트 기록 (중복 처리 방지, ERD 3-8).
 *
 * <p>중복 판단은 {@code ProcessedEventRepository#insertIfAbsent}(INSERT ... ON CONFLICT DO NOTHING)로 수신
 * 처리 맨 앞에서 한다. 결과가 0이면 이미 처리한 이벤트이므로 업무 처리 없이 ack 한다. PK(event_id)는 최종 안전장치다.
 */
@Entity
@Table(name = "processed_events")
public class ProcessedEvent {

  @Id
  @Column(name = "event_id")
  private UUID eventId;

  @Column(name = "processed_at", nullable = false)
  private Instant processedAt;

  protected ProcessedEvent() {}

  public UUID getEventId() {
    return eventId;
  }

  public Instant getProcessedAt() {
    return processedAt;
  }
}
