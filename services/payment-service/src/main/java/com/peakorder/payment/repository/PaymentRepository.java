package com.peakorder.payment.repository;

import com.peakorder.payment.entity.Payment;
import jakarta.persistence.LockModeType;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface PaymentRepository extends JpaRepository<Payment, Long> {

  Optional<Payment> findByIdempotencyKey(String idempotencyKey);

  Optional<Payment> findByOrderId(Long orderId);

  /** 환불처럼 상태를 바꿀 때 쓴다. 같은 결제에 동시에 온 요청은 한 번에 하나만 처리된다. */
  @Lock(LockModeType.PESSIMISTIC_WRITE)
  @Query("select p from Payment p where p.id = :id")
  Optional<Payment> findByIdForUpdate(@Param("id") Long id);
}
