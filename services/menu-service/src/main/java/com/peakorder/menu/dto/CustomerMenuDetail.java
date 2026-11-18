package com.peakorder.menu.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.peakorder.menu.entity.MenuStatus;
import io.swagger.v3.oas.annotations.media.Schema;
import java.util.List;

@JsonInclude(JsonInclude.Include.ALWAYS)
public record CustomerMenuDetail(
    Long id,
    Long categoryId,
    String name,
    @Schema(nullable = true) String description,
    @Schema(nullable = true) String imageUrl,
    int basePrice,
    MenuStatus status,
    List<Option> options) {
  @Schema(name = "CustomerMenuOption")
  public record Option(Long id, String name, int extraPrice, boolean isDefault, boolean active) {}
}
