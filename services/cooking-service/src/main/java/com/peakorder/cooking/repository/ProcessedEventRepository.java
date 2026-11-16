package com.peakorder.cooking.repository;

import com.peakorder.cooking.entity.ProcessedEvent;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/** 수신 이벤트 중복 처리 방지 (ERD 3-8: eventId 저장 → 업무 처리 → 커밋 후 ack) */
public interface ProcessedEventRepository extends JpaRepository<ProcessedEvent, UUID> {}
