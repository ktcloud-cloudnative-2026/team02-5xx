package com.peakorder.order.repository;

import java.time.OffsetDateTime;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/** 발행할 이벤트 저장(outbox). 업무 데이터와 같은 트랜잭션에서 호출해야 유실되지 않는다. */
@Repository
public class OutboxEventRepository {

  private static final String INSERT_SQL =
      """
      INSERT INTO outbox_events (event_id, event_type, payload, status, created_at)
      VALUES (?, ?, ?::jsonb, 'PENDING', ?)
      """;

  private final JdbcTemplate jdbcTemplate;

  public OutboxEventRepository(JdbcTemplate jdbcTemplate) {
    this.jdbcTemplate = jdbcTemplate;
  }

  public void insertPending(
      UUID eventId, String eventType, String payloadJson, OffsetDateTime createdAt) {
    jdbcTemplate.update(INSERT_SQL, eventId, eventType, payloadJson, createdAt);
  }
}
