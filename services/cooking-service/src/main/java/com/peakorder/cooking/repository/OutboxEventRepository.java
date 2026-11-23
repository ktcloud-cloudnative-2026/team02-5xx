package com.peakorder.cooking.repository;

import com.peakorder.cooking.entity.OutboxEvent;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** 발행할 이벤트 저장(outbox). 업무 데이터와 같은 트랜잭션에서 저장해야 유실되지 않는다. */
public interface OutboxEventRepository extends JpaRepository<OutboxEvent, Long> {

  /**
   * 발행 대기(PENDING) 이벤트를 오래된 순서로 잠그고 읽는다. 여러 인스턴스가 같은 이벤트를 동시에 발행하지 않도록 이미 잠긴 행은 건너뛴다(SKIP LOCKED).
   * 호출한 트랜잭션이 끝날 때까지 잠금이 유지된다.
   */
  @Query(
      value =
          "SELECT * FROM outbox_events WHERE status = 'PENDING' ORDER BY id LIMIT :limit "
              + "FOR UPDATE SKIP LOCKED",
      nativeQuery = true)
  List<OutboxEvent> findPendingForUpdate(@Param("limit") int limit);

  /**
   * 발행 대기(PENDING) 이벤트 수 — 지표 {@code cooking_outbox_pending}(#243). 상태 값을 쿼리에 직접 써야 부분 인덱스 {@code
   * idx_outbox_events_pending}(WHERE status = 'PENDING')를 쓸 수 있다. 바인드 파라미터로 넘기면 일반 실행 계획에서 부분 인덱스를
   * 못 쓸 수 있다.
   */
  @Query(value = "SELECT count(*) FROM outbox_events WHERE status = 'PENDING'", nativeQuery = true)
  long countPending();
}
