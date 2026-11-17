package com.peakorder.menu.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import java.util.List;

public record ValidatePurchaseResponse(List<Item> items) {
  @Schema(name = "PurchaseValidationResultItem")
  public record Item(
      Long menuId,
      String menuName,
      @Schema(
              description = "Base price per menu, excluding options and quantity",
              minimum = "0")
          int unitPrice,
      @Schema(description = "Base cooking time per menu in seconds", minimum = "0")
          int cookTimeSec,
      List<Option> options) {}

  @Schema(name = "PurchaseValidationResultOption")
  public record Option(
      Long optionId,
      String optionName,
      @Schema(minimum = "0") int extraPrice,
      @Schema(description = "Additional cooking time per option in seconds", minimum = "0")
          int extraCookTimeSec) {}
}
