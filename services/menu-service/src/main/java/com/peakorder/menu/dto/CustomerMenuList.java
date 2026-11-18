package com.peakorder.menu.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.peakorder.menu.entity.MenuStatus;
import io.swagger.v3.oas.annotations.media.Schema;
import java.util.List;

public record CustomerMenuList(List<CategoryItem> categories, List<MenuItem> menus) {
  @Schema(name = "CustomerMenuCategory")
  public record CategoryItem(Long id, String name) {}

  @JsonInclude(JsonInclude.Include.ALWAYS)
  @Schema(name = "CustomerMenuSummary")
  public record MenuItem(
      Long id,
      Long categoryId,
      String name,
      @Schema(nullable = true) String imageUrl,
      int basePrice,
      MenuStatus status) {}
}
