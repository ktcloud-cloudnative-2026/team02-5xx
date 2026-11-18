package com.peakorder.menu.dto;

import com.peakorder.menu.entity.MenuStatus;
import java.util.List;

public record CustomerMenuListResponse(List<CategoryItem> categories, List<MenuItem> menus) {
  public record CategoryItem(Long id, String name) {}

  public record MenuItem(
      Long id, Long categoryId, String name, String imageUrl, int basePrice, MenuStatus status) {}
}
