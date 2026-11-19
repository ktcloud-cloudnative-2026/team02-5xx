package com.peakorder.inventory.repository;

import com.peakorder.inventory.entity.InventoryReservationItem;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface InventoryReservationItemRepository
    extends JpaRepository<InventoryReservationItem, Long> {

  List<InventoryReservationItem> findByReservationId(Long reservationId);
}
