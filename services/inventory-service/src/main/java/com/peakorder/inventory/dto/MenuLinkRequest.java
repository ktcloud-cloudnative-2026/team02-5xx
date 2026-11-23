package com.peakorder.inventory.dto;

import jakarta.validation.constraints.Positive;

public record MenuLinkRequest(@Positive Long menuId) {}
