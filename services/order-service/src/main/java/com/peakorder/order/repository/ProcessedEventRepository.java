package com.peakorder.order.repository;

import java.time.OffsetDateTime;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/** 처리한 이벤트 기록(processed_events). 같은 이벤트가 다시 와도 한 번만 처리하기 위해 쓴다. */
@Repository
public class ProcessedEventRepository {

  private static final String INSERT_SQL =
      """
      INSERT INTO processed_events (event_id, processed_at) VALUES (?, ?)
      ON CONFLICT (event_id) DO NOTHING
      """;

  private final JdbcTemplate jdbcTemplate;

  public ProcessedEventRepository(JdbcTemplate jdbcTemplate) {
    this.jdbcTemplate = jdbcTemplate;
  }

  /**
   * @return 처음 처리하는 이벤트면 true, 이미 처리한 이벤트면 false
   */
  public boolean insertIfAbsent(UUID eventId, OffsetDateTime processedAt) {
    return jdbcTemplate.update(INSERT_SQL, eventId, processedAt) > 0;
  }
}
