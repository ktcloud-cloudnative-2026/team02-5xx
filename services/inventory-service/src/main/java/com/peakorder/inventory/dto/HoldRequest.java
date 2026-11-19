package com.peakorder.inventory.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import java.util.List;

public record HoldRequest(@NotNull Long orderId, @NotEmpty List<@Valid Item> items) {

  public record Item(@NotNull Long menuId, @Positive int quantity) {}
}
