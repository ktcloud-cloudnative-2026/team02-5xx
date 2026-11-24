package com.peakorder.order.repository;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.jdbc.core.JdbcTemplate;

class OutboxEventRepositoryCountPendingTest {

  private final JdbcTemplate jdbcTemplate = mock(JdbcTemplate.class);
  private final OutboxEventRepository repository = new OutboxEventRepository(jdbcTemplate);

  @Test
  void count_pending_returns_the_database_count() {
    when(jdbcTemplate.queryForObject(anyString(), eq(Long.class))).thenReturn(7L);

    assertThat(repository.countPending()).isEqualTo(7L);
  }

  @Test
  void count_pending_treats_a_missing_row_as_zero() {
    when(jdbcTemplate.queryForObject(anyString(), eq(Long.class))).thenReturn(null);

    assertThat(repository.countPending()).isZero();
  }

  @Test
  void the_query_writes_the_status_literally_so_the_partial_index_can_be_used() {
    when(jdbcTemplate.queryForObject(anyString(), eq(Long.class))).thenReturn(0L);

    repository.countPending();

    ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
    verify(jdbcTemplate).queryForObject(sql.capture(), eq(Long.class));
    // 바인드 파라미터(?)로 넘기면 부분 인덱스(idx_outbox_events_pending)를 못 쓸 수 있다
    assertThat(sql.getValue()).contains("status = 'PENDING'").doesNotContain("?");
  }
}
