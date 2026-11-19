package com.peakorder.inventory.dto;

import jakarta.validation.constraints.NotNull;

public record RestoreRequest(@NotNull Long orderId) {}
