package com.peakorder.order.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
import java.util.List;

public record CreateOrderRequest(@NotEmpty @Size(max = 20) List<@Valid @NotNull OrderLine> items) {

  public record OrderLine(
      @NotNull @Positive Long menuId,
      @NotNull @Min(1) @Max(99) Integer quantity,
      @Size(max = 20) List<@NotNull @Positive Long> optionIds) {

    public List<Long> optionIdsOrEmpty() {
      return optionIds == null ? List.of() : optionIds;
    }
  }
}
