package com.peakorder.order.repository;

import com.peakorder.order.entity.StoreOperation;
import jakarta.persistence.LockModeType;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface StoreOperationRepository extends JpaRepository<StoreOperation, Long> {

  /** 동시에 두 관리자가 부분 변경(PATCH)해도 서로의 값을 덮어쓰지 않도록 행 잠금과 함께 조회한다. */
  @Lock(LockModeType.PESSIMISTIC_WRITE)
  @Query("select s from StoreOperation s where s.id = :id")
  Optional<StoreOperation> findWithLockById(@Param("id") Long id);
}
