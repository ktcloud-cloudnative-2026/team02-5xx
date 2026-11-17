package com.peakorder.menu.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import java.util.List;

public record ValidatePurchaseRequest(
    @Schema(
            description = "Ordered purchase lines",
            requiredMode = Schema.RequiredMode.REQUIRED)
        List<Item> items) {
  @Schema(name = "PurchaseValidationRequestItem")
  public record Item(
      @Schema(minimum = "1", requiredMode = Schema.RequiredMode.REQUIRED) Long menuId,
      @Schema(minimum = "1", requiredMode = Schema.RequiredMode.REQUIRED) Integer quantity,
      @Schema(
              description = "Selected option IDs; empty array means no options",
              requiredMode = Schema.RequiredMode.REQUIRED)
          List<Long> optionIds) {}
}
