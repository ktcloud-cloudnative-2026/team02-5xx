package com.peakorder.inventory.dto;

import com.peakorder.inventory.entity.Inventory;

public record StockItemResponse(
    Long stockItemId,
    Long menuId,
    int stockQty,
    int reservedQty,
    int availableQty,
    int lowStockThreshold,
    boolean lowStock) {

  public static StockItemResponse from(Inventory inventory) {
    return new StockItemResponse(
        inventory.getId(),
        inventory.getMenuId(),
        inventory.getStockQty(),
        inventory.getReservedQty(),
        inventory.getAvailableQty(),
        inventory.getLowStockThreshold(),
        inventory.isLowStock());
  }
}
