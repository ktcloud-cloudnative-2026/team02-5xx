package com.peakorder.menu.dto;

import com.peakorder.menu.entity.MenuStatus;
import java.util.List;

public record CustomerMenuDetailResponse(
    Long id,
    Long categoryId,
    String name,
    String description,
    String imageUrl,
    int basePrice,
    MenuStatus status,
    List<OptionItem> options) {
  public record OptionItem(
      Long id, String name, int extraPrice, boolean isDefault, boolean active) {}
}
