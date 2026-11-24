package com.peakorder.menu.dto;

import com.peakorder.menu.entity.MenuStatus;
import com.peakorder.menu.exception.MenuStatusChangeException;
import io.swagger.v3.oas.annotations.media.Schema;
import tools.jackson.databind.JsonNode;

public record MenuStatusRequest(
    @Schema(
            requiredMode = Schema.RequiredMode.REQUIRED,
            description = "Exact ON_SALE / PAUSED / HIDDEN value")
        MenuStatus status) {
  public static MenuStatusRequest parse(JsonNode node) {
    if (node == null
        || !node.isObject()
        || node.size() != 1
        || !node.has("status")
        || !node.get("status").isString()) throw MenuStatusChangeException.invalid();
    try {
      return new MenuStatusRequest(MenuStatus.valueOf(node.get("status").asString()));
    } catch (IllegalArgumentException e) {
      throw MenuStatusChangeException.invalid();
    }
  }
}
