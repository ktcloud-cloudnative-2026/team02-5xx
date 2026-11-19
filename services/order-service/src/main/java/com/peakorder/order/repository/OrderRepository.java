package com.peakorder.order.repository;

import com.peakorder.order.entity.Order;
import com.peakorder.order.entity.OrderStatus;
import jakarta.persistence.LockModeType;
import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface OrderRepository extends JpaRepository<Order, Long> {

  Optional<Order> findByIdAndUserId(Long id, Long userId);

  /** 상태 전이처럼 동시 변경을 막아야 할 때 행 잠금과 함께 조회한다. */
  @Lock(LockModeType.PESSIMISTIC_WRITE)
  Optional<Order> findWithLockById(Long id);

  Page<Order> findByUserIdAndStatusNotIn(
      Long userId, Collection<OrderStatus> statuses, Pageable pageable);

  /**
   * 처리 독점을 잡는다. 주문이 {@code statuses} 중 하나이고 다른 요청의 독점이 없거나 만료됐을 때만 한 요청이 성공(1)한다. 조건 확인과 갱신이 한 문장이라
   * 동시에 두 요청이 잡을 수 없다. 잡을 때마다 새 토큰으로 바뀌므로, 이전 소유자는 이후 토큰 검증에서 걸러진다. 결제(CREATED)와 취소(그 밖의 상태)가 같은
   * 독점을 쓴다.
   */
  @Modifying(clearAutomatically = true, flushAutomatically = true)
  @Query(
      "update Order o set o.payLockUntil = :until, o.payLockToken = :token where o.id = :id"
          + " and o.status in :statuses"
          + " and (o.payLockUntil is null or o.payLockUntil <= :now)")
  int acquirePayLock(
      @Param("id") Long id,
      @Param("now") OffsetDateTime now,
      @Param("until") OffsetDateTime until,
      @Param("token") UUID token,
      @Param("statuses") Collection<OrderStatus> statuses);

  /** 토큰이 일치할 때만 독점 만료를 늦춘다. 일치하지 않으면 0(독점을 잃었다). */
  @Modifying(clearAutomatically = true, flushAutomatically = true)
  @Query("update Order o set o.payLockUntil = :until where o.id = :id and o.payLockToken = :token")
  int renewPayLock(
      @Param("id") Long id, @Param("until") OffsetDateTime until, @Param("token") UUID token);

  /** 취소 후속 처리(재고 복원·환불)가 남은 주문 ID. 오래된 취소부터, 이미 다른 요청이 처리 중인 주문은 건너뛴다. */
  @Query(
      "select o.id from Order o where o.status = com.peakorder.order.entity.OrderStatus.CANCELED"
          + " and o.orderNo is not null and o.canceledAt <= :before"
          + " and (o.payLockUntil is null or o.payLockUntil <= :now)"
          + " and o.cancelFollowUpManualAt is null"
          + " and (o.cancelFollowUpNextAttemptAt is null or o.cancelFollowUpNextAttemptAt <= :now)"
          + " and (o.stockRestoredAt is null or (o.paymentId is not null and o.refundedAt is null))"
          + " order by o.canceledAt asc")
  List<Long> findCancelFollowUpIds(
      @Param("before") OffsetDateTime before, @Param("now") OffsetDateTime now, Pageable pageable);

  /** 수동 확인이 필요하다고 표시됐고 후속 처리(복원·환불)가 아직 끝나지 않은 취소 주문 수(지표용). */
  @Query(
      "select count(o) from Order o where o.status = com.peakorder.order.entity.OrderStatus.CANCELED"
          + " and o.orderNo is not null and o.cancelFollowUpManualAt is not null"
          + " and (o.stockRestoredAt is null or (o.paymentId is not null and o.refundedAt is null))")
  long countCancelFollowUpManual();

  /**
   * Cooking 응답을 모른 채 남은 취소 요청의 주문 ID. 확정된 주문(조리 완료 제외) 중 취소를 요청했고 아직 결과를 확정하지 못한 것을 오래된 요청부터, 다른
   * 요청이 처리 중인 주문은 건너뛴다.
   */
  @Query(
      "select o.id from Order o where o.status in :statuses"
          + " and o.cancelRequestedAt is not null and o.cancelRequestedAt <= :before"
          + " and (o.payLockUntil is null or o.payLockUntil <= :now)"
          + " order by o.cancelRequestedAt asc")
  List<Long> findCancelRequestIds(
      @Param("statuses") Collection<OrderStatus> statuses,
      @Param("before") OffsetDateTime before,
      @Param("now") OffsetDateTime now,
      Pageable pageable);

  /** 토큰이 일치할 때만 독점을 놓는다. 다른 요청이 이어받은 독점은 건드리지 않는다. */
  @Modifying(clearAutomatically = true, flushAutomatically = true)
  @Query(
      "update Order o set o.payLockUntil = null, o.payLockToken = null"
          + " where o.id = :id and o.payLockToken = :token")
  int releasePayLock(@Param("id") Long id, @Param("token") UUID token);
}
