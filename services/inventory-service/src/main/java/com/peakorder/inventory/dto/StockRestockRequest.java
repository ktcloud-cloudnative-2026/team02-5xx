package com.peakorder.inventory.dto;

import jakarta.validation.constraints.Positive;

public record StockRestockRequest(@Positive int quantity) {}
