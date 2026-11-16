package com.peakorder.order.repository;

import com.peakorder.order.entity.Order;
import com.peakorder.order.entity.OrderStatus;
import jakarta.persistence.LockModeType;
import java.util.Collection;
import java.util.Optional;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;

public interface OrderRepository extends JpaRepository<Order, Long> {

  Optional<Order> findByIdAndUserId(Long id, Long userId);

  /** 상태 전이처럼 동시 변경을 막아야 할 때 행 잠금과 함께 조회한다. */
  @Lock(LockModeType.PESSIMISTIC_WRITE)
  Optional<Order> findWithLockById(Long id);

  Page<Order> findByUserIdAndStatusNotIn(
      Long userId, Collection<OrderStatus> statuses, Pageable pageable);
}
