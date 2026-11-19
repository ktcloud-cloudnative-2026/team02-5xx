package com.peakorder.cooking.repository;

import com.peakorder.cooking.entity.CookingTicket;
import com.peakorder.cooking.entity.TicketStatus;
import jakarta.persistence.LockModeType;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface CookingTicketRepository extends JpaRepository<CookingTicket, Long> {

  /** 주문 ID로 전표 조회 (CI-02 상태 조회, 등록 여부 확인) */
  Optional<CookingTicket> findByOrderId(Long orderId);

  /**
   * 주문 ID로 전표를 행 잠금(SELECT … FOR UPDATE)으로 조회한다. 상태를 바꾸는 처리(CI-03 취소, 자동 조리 진행)는 이 잠금 안에서 상태를 다시
   * 확인해, 동시에 일어나도 한쪽만 성공하게 한다. 트랜잭션 안에서 호출해야 한다.
   */
  @Lock(LockModeType.PESSIMISTIC_WRITE)
  @Query("select t from CookingTicket t where t.orderId = :orderId")
  Optional<CookingTicket> findWithLockByOrderId(@Param("orderId") Long orderId);

  /** 상태별 FIFO 목록: Cooking DB 등록 순서(queued_at, id) 기준 (CO-04 대기열) */
  List<CookingTicket> findByStatusOrderByQueuedAtAscIdAsc(TicketStatus status);

  /** 상태별 건수 (CO-01 대기 주문 수, CO-03 현황) */
  long countByStatus(TicketStatus status);

  /** FIFO 기준으로 기준 전표(queuedAt, id)보다 앞에 있는 해당 상태 전표 수 */
  @Query(
      "select count(t) from CookingTicket t where t.status = :status "
          + "and (t.queuedAt < :queuedAt or (t.queuedAt = :queuedAt and t.id < :id))")
  long countAheadByStatus(
      @Param("status") TicketStatus status,
      @Param("queuedAt") Instant queuedAt,
      @Param("id") Long id);

  /** FIFO 기준으로 기준 전표(queuedAt, id)보다 앞에 있는 해당 상태 전표들의 예상 조리 시간 합(초) */
  @Query(
      "select coalesce(sum(t.estimatedCookSec), 0) from CookingTicket t where t.status = :status "
          + "and (t.queuedAt < :queuedAt or (t.queuedAt = :queuedAt and t.id < :id))")
  long sumEstimatedCookSecAheadByStatus(
      @Param("status") TicketStatus status,
      @Param("queuedAt") Instant queuedAt,
      @Param("id") Long id);
}
