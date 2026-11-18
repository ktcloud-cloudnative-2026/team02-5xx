package com.peakorder.order.repository;

import com.peakorder.order.entity.Order;
import com.peakorder.order.entity.OrderStatus;
import jakarta.persistence.LockModeType;
import java.time.OffsetDateTime;
import java.util.Collection;
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
   * 결제 처리 독점을 잡는다. 주문이 CREATED이고 다른 요청의 독점이 없거나 만료됐을 때만 한 요청이 성공(1)한다. 조건 확인과 갱신이 한 문장이라 동시에 두 요청이
   * 잡을 수 없다. 잡을 때마다 새 토큰으로 바뀌므로, 이전 소유자는 이후 토큰 검증에서 걸러진다.
   */
  @Modifying(clearAutomatically = true, flushAutomatically = true)
  @Query(
      "update Order o set o.payLockUntil = :until, o.payLockToken = :token where o.id = :id"
          + " and o.status = com.peakorder.order.entity.OrderStatus.CREATED"
          + " and (o.payLockUntil is null or o.payLockUntil <= :now)")
  int acquirePayLock(
      @Param("id") Long id,
      @Param("now") OffsetDateTime now,
      @Param("until") OffsetDateTime until,
      @Param("token") UUID token);

  /** 토큰이 일치할 때만 독점 만료를 늦춘다. 일치하지 않으면 0(독점을 잃었다). */
  @Modifying(clearAutomatically = true, flushAutomatically = true)
  @Query(
      "update Order o set o.payLockUntil = :until where o.id = :id and o.payLockToken = :token"
          + " and o.status = com.peakorder.order.entity.OrderStatus.CREATED")
  int renewPayLock(
      @Param("id") Long id, @Param("until") OffsetDateTime until, @Param("token") UUID token);

  /** 토큰이 일치할 때만 독점을 놓는다. 다른 요청이 이어받은 독점은 건드리지 않는다. */
  @Modifying(clearAutomatically = true, flushAutomatically = true)
  @Query(
      "update Order o set o.payLockUntil = null, o.payLockToken = null"
          + " where o.id = :id and o.payLockToken = :token")
  int releasePayLock(@Param("id") Long id, @Param("token") UUID token);
}
