package com.peakorder.inventory.dto;

public record AvailabilityResponse(Long menuId, boolean orderable, int availableQty) {}
