package com.peakorder.inventory.repository;

import com.peakorder.inventory.entity.InventoryReservation;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface InventoryReservationRepository extends JpaRepository<InventoryReservation, Long> {

  Optional<InventoryReservation> findByOrderId(Long orderId);
}
