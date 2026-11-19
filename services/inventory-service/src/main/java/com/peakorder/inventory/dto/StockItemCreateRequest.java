package com.peakorder.inventory.dto;

import jakarta.validation.constraints.PositiveOrZero;

public record StockItemCreateRequest(
    @PositiveOrZero int stockQty, @PositiveOrZero int lowStockThreshold) {}
