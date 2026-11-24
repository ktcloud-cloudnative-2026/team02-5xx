package com.peakorder.order.repository;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/** 발행할 이벤트 저장(outbox). 업무 데이터와 같은 트랜잭션에서 저장해야 유실되지 않는다. */
@Repository
public class OutboxEventRepository {

  private static final String INSERT_SQL =
      """
      INSERT INTO outbox_events (event_id, event_type, payload, status, created_at)
      VALUES (?, ?, ?::jsonb, 'PENDING', ?)
      """;

  /** 여러 인스턴스가 같은 이벤트를 동시에 발행하지 않도록 잠긴 행은 건너뛴다. */
  private static final String SELECT_PENDING_SQL =
      """
      SELECT id, event_id, event_type, payload::text AS payload
      FROM outbox_events
      WHERE status = 'PENDING'
      ORDER BY id
      LIMIT ?
      FOR UPDATE SKIP LOCKED
      """;

  private static final String MARK_SENT_SQL =
      "UPDATE outbox_events SET status = 'SENT', sent_at = ? WHERE id = ?";

  /**
   * 발행 대기(PENDING) 건수 — 지표 {@code order_outbox_pending}(#272). 상태 값을 쿼리에 직접 써야 부분 인덱스 {@code
   * idx_outbox_events_pending}(WHERE status = 'PENDING')를 쓸 수 있다. 바인드 파라미터로 넘기면 일반 실행 계획에서 부분 인덱스를
   * 못 쓸 수 있다.
   */
  private static final String COUNT_PENDING_SQL =
      "SELECT count(*) FROM outbox_events WHERE status = 'PENDING'";

  private final JdbcTemplate jdbcTemplate;

  public OutboxEventRepository(JdbcTemplate jdbcTemplate) {
    this.jdbcTemplate = jdbcTemplate;
  }

  public record PendingEvent(Long id, UUID eventId, String eventType, String payload) {}

  public void insertPending(
      UUID eventId, String eventType, String payloadJson, OffsetDateTime createdAt) {
    jdbcTemplate.update(INSERT_SQL, eventId, eventType, payloadJson, createdAt);
  }

  /** 발행 대기 중인 이벤트를 오래된 순서로 잠그고 읽는다. 호출한 트랜잭션이 끝날 때까지 잠금이 유지된다. */
  public List<PendingEvent> findPendingForUpdate(int limit) {
    return jdbcTemplate.query(
        SELECT_PENDING_SQL,
        (rs, rowNum) ->
            new PendingEvent(
                rs.getLong("id"),
                rs.getObject("event_id", UUID.class),
                rs.getString("event_type"),
                rs.getString("payload")),
        limit);
  }

  public void markSent(Long id, OffsetDateTime sentAt) {
    jdbcTemplate.update(MARK_SENT_SQL, sentAt, id);
  }

  /** 발행 대기(PENDING) 이벤트 수. 지표 수집(scrape)마다 호출되므로 부분 인덱스를 타는 쿼리를 쓴다. */
  public long countPending() {
    Long count = jdbcTemplate.queryForObject(COUNT_PENDING_SQL, Long.class);
    return count == null ? 0L : count;
  }
}
