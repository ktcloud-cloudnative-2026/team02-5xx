package com.peakorder.menu.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.peakorder.menu.entity.MenuStatus;
import io.swagger.v3.oas.annotations.media.Schema;
import java.util.List;

/** Proposed ME-03 data contract; the administrator endpoint is denied by default. */
public record AdminMenuList(List<CategoryItem> categories, List<MenuItem> menus) {
  @Schema(name = "AdminMenuCategory")
  public record CategoryItem(Long id, String name) {}

  @JsonInclude(JsonInclude.Include.ALWAYS)
  @Schema(name = "AdminMenuSummary")
  public record MenuItem(
      Long id,
      Long categoryId,
      String name,
      @Schema(nullable = true) String imageUrl,
      int basePrice,
      int cookTimeSec,
      MenuStatus status) {}
}
