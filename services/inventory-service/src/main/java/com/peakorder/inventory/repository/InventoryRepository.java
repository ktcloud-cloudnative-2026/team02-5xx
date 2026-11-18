package com.peakorder.inventory.repository;

import com.peakorder.inventory.entity.Inventory;
import jakarta.persistence.LockModeType;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;

public interface InventoryRepository extends JpaRepository<Inventory, Long> {

  Optional<Inventory> findByMenuId(Long menuId);

  @Lock(LockModeType.PESSIMISTIC_WRITE)
  @Query("select i from Inventory i where i.menuId = :menuId")
  Optional<Inventory> findByMenuIdForUpdate(Long menuId);
}
