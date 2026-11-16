package com.peakorder.cooking.repository;

import com.peakorder.cooking.entity.CookingTicket;
import com.peakorder.cooking.entity.TicketStatus;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface CookingTicketRepository extends JpaRepository<CookingTicket, Long> {

  /** 주문 ID로 전표 조회 (CI-02 상태 조회, CI-03 취소, 등록 여부 확인) */
  Optional<CookingTicket> findByOrderId(Long orderId);

  /** 상태별 FIFO 목록: Cooking DB 등록 순서(queued_at, id) 기준 (CO-04 대기열) */
  List<CookingTicket> findByStatusOrderByQueuedAtAscIdAsc(TicketStatus status);

  /** 상태별 건수 (CO-01 대기 주문 수, CO-03 현황) */
  long countByStatus(TicketStatus status);
}
