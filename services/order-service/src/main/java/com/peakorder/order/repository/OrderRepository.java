package com.peakorder.order.repository;

import com.peakorder.order.entity.Order;
import com.peakorder.order.entity.OrderStatus;
import java.util.Collection;
import java.util.Optional;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

public interface OrderRepository extends JpaRepository<Order, Long> {

  Optional<Order> findByIdAndUserId(Long id, Long userId);

  Page<Order> findByUserIdAndStatusNotIn(
      Long userId, Collection<OrderStatus> statuses, Pageable pageable);
}
