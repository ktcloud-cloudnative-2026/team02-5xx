package com.peakorder.inventory.repository;

import com.peakorder.inventory.entity.InventoryReservationItem;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

public interface InventoryReservationItemRepository
    extends JpaRepository<InventoryReservationItem, Long> {

  List<InventoryReservationItem> findByReservationId(Long reservationId);

  @Query(
      "select case when count(i) > 0 then true else false end"
          + " from InventoryReservationItem i, InventoryReservation r"
          + " where i.reservationId = r.id and i.menuId = :menuId and r.status = 'RESERVED'")
  boolean existsActiveHoldForMenu(Long menuId);
}
