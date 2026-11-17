package com.peakorder.inventory.repository;

import com.peakorder.inventory.entity.Inventory;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface InventoryRepository extends JpaRepository<Inventory, Long> {

  Optional<Inventory> findByMenuId(Long menuId);
}
