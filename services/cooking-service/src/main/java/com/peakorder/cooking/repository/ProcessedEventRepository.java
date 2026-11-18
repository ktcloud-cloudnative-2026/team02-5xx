package com.peakorder.cooking.repository;

import com.peakorder.cooking.entity.ProcessedEvent;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** 수신 이벤트 중복 처리 방지 (ERD 3-8: ① eventId 저장 → ② 업무 처리 → ③ 커밋 후 ack) */
public interface ProcessedEventRepository extends JpaRepository<ProcessedEvent, UUID> {

  /**
   * 처리 기록을 즉시 저장한다. 수신 처리 트랜잭션의 첫 단계(①)에서 호출한다.
   *
   * @return 1이면 처음 받은 이벤트(계속 처리), 0이면 이미 처리한 이벤트(업무 처리 없이 ack)
   */
  @Modifying
  @Query(
      value =
          "INSERT INTO processed_events (event_id, processed_at) VALUES (:eventId, now()) "
              + "ON CONFLICT (event_id) DO NOTHING",
      nativeQuery = true)
  int insertIfAbsent(@Param("eventId") UUID eventId);
}
