package com.peakorder.menu.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.peakorder.menu.entity.MenuStatus;
import io.swagger.v3.oas.annotations.media.Schema;
import java.time.Instant;
import java.util.List;

/** Proposed ME-04 data contract, including hidden menus and inactive options. */
@JsonInclude(JsonInclude.Include.ALWAYS)
public record AdminMenuDetail(
    Long id,
    Long categoryId,
    String name,
    @Schema(nullable = true) String description,
    @Schema(nullable = true) String imageUrl,
    int basePrice,
    int cookTimeSec,
    MenuStatus status,
    Instant createdAt,
    Instant updatedAt,
    List<Option> options) {
  @Schema(name = "AdminMenuOption")
  public record Option(
      Long id,
      String name,
      int extraPrice,
      int extraCookTimeSec,
      boolean isDefault,
      boolean active) {}
}
