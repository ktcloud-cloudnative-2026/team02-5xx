package com.peakorder.inventory.service;

import com.peakorder.inventory.dto.StockItemCreateRequest;
import com.peakorder.inventory.dto.StockItemResponse;
import com.peakorder.inventory.dto.StockRestockRequest;
import com.peakorder.inventory.entity.Inventory;
import com.peakorder.inventory.exception.BusinessException;
import com.peakorder.inventory.exception.ErrorCode;
import com.peakorder.inventory.repository.InventoryRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class InventoryAdminService {

  private final InventoryRepository inventoryRepository;

  public InventoryAdminService(InventoryRepository inventoryRepository) {
    this.inventoryRepository = inventoryRepository;
  }

  @Transactional
  public StockItemResponse create(StockItemCreateRequest request) {
    Inventory saved =
        inventoryRepository.save(new Inventory(request.stockQty(), request.lowStockThreshold()));
    return StockItemResponse.from(saved);
  }

  @Transactional
  public StockItemResponse restock(Long stockItemId, StockRestockRequest request) {
    Inventory inventory = lockStockItem(stockItemId);
    inventory.addStock(request.quantity());
    return StockItemResponse.from(inventory);
  }

  private Inventory lockStockItem(Long stockItemId) {
    return inventoryRepository
        .findByIdForUpdate(stockItemId)
        .orElseThrow(() -> new BusinessException(ErrorCode.INVENTORY_NOT_FOUND));
  }
}
