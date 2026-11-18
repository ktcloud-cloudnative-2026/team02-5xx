package com.peakorder.inventory.repository;

import com.peakorder.inventory.entity.InventoryReservation;
import jakarta.persistence.LockModeType;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;

public interface InventoryReservationRepository extends JpaRepository<InventoryReservation, Long> {

  Optional<InventoryReservation> findByOrderId(Long orderId);

  @Lock(LockModeType.PESSIMISTIC_WRITE)
  @Query("select r from InventoryReservation r where r.id = :id")
  Optional<InventoryReservation> findByIdForUpdate(Long id);
}
