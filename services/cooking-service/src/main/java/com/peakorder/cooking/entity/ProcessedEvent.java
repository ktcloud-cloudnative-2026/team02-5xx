package com.peakorder.cooking.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.PostLoad;
import jakarta.persistence.PostPersist;
import jakarta.persistence.Table;
import jakarta.persistence.Transient;
import java.time.Instant;
import java.util.UUID;
import org.springframework.data.domain.Persistable;

/**
 * 처리 완료한 수신 이벤트 기록 (중복 처리 방지).
 *
 * <p>ID(eventId)를 직접 지정하므로 {@link Persistable}로 새 엔티티임을 알려, save() 시 조회 없이 INSERT 한다. 이미 처리한 이벤트면
 * PK 중복으로 저장이 실패해 중복 처리를 막는다.
 */
@Entity
@Table(name = "processed_events")
public class ProcessedEvent implements Persistable<UUID> {

  @Id
  @Column(name = "event_id")
  private UUID eventId;

  @Column(name = "event_type", nullable = false, length = 100)
  private String eventType;

  @Column(name = "processed_at", nullable = false)
  private Instant processedAt;

  @Transient private boolean isNew = true;

  protected ProcessedEvent() {}

  public static ProcessedEvent of(UUID eventId, String eventType, Instant now) {
    ProcessedEvent event = new ProcessedEvent();
    event.eventId = eventId;
    event.eventType = eventType;
    event.processedAt = now;
    return event;
  }

  @PostLoad
  @PostPersist
  void markNotNew() {
    this.isNew = false;
  }

  @Override
  public UUID getId() {
    return eventId;
  }

  @Override
  public boolean isNew() {
    return isNew;
  }

  public String getEventType() {
    return eventType;
  }

  public Instant getProcessedAt() {
    return processedAt;
  }
}
