package com.peakorder.cooking.repository;

import com.peakorder.cooking.entity.OutboxEvent;
import com.peakorder.cooking.entity.OutboxStatus;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface OutboxEventRepository extends JpaRepository<OutboxEvent, Long> {

  /** 발행 대기 이벤트를 오래된 순으로 최대 100건 조회 (발행 작업용) */
  List<OutboxEvent> findTop100ByStatusOrderByCreatedAtAsc(OutboxStatus status);
}
