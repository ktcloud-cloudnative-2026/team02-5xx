package com.peakorder.order.repository;

import java.time.LocalDate;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/** 날짜별 주문 일련번호. 호출한 트랜잭션과 함께 커밋·롤백되므로 번호가 비지 않는다. */
@Repository
public class OrderNoRepository {

  private static final String NEXT_SEQ_SQL =
      """
      INSERT INTO order_no_counters (order_date, last_seq) VALUES (?, 1)
      ON CONFLICT (order_date) DO UPDATE SET last_seq = order_no_counters.last_seq + 1
      RETURNING last_seq
      """;

  private final JdbcTemplate jdbcTemplate;

  public OrderNoRepository(JdbcTemplate jdbcTemplate) {
    this.jdbcTemplate = jdbcTemplate;
  }

  public int nextSequence(LocalDate orderDate) {
    Integer seq = jdbcTemplate.queryForObject(NEXT_SEQ_SQL, Integer.class, orderDate);
    return seq == null ? 1 : seq;
  }
}
