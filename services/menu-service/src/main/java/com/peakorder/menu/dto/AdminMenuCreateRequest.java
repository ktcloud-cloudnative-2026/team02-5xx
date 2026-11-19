package com.peakorder.menu.dto;

import com.peakorder.menu.entity.MenuStatus;
import com.peakorder.menu.exception.MenuCreateException;
import io.swagger.v3.oas.annotations.media.Schema;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import tools.jackson.databind.JsonNode;

/** Proposed ME-05 contract. JSON types are checked without changing shared Jackson settings. */
public record AdminMenuCreateRequest(
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED, minimum = "1") Long categoryId,
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED, maxLength = 255) String name,
    String description,
    @Schema(maxLength = 255, nullable = true) String imageUrl,
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED, minimum = "0") Integer basePrice,
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED, minimum = "0") Integer cookTimeSec,
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED) MenuStatus status,
    List<Option> options) {
  @Schema(name = "MenuCreateOptionRequest")
  public record Option(
      @Schema(requiredMode = Schema.RequiredMode.REQUIRED, maxLength = 255) String name,
      @Schema(requiredMode = Schema.RequiredMode.REQUIRED, minimum = "0") Integer extraPrice,
      @Schema(requiredMode = Schema.RequiredMode.REQUIRED, minimum = "0") Integer extraCookTimeSec,
      @Schema(defaultValue = "false") Boolean isDefault,
      @Schema(defaultValue = "true") Boolean active) {}

  public static AdminMenuCreateRequest fromJson(JsonNode node) {
    fields(
        node,
        Set.of(
            "categoryId",
            "name",
            "description",
            "imageUrl",
            "basePrice",
            "cookTimeSec",
            "status",
            "options"));
    var id = node.path("categoryId");
    if (!id.isIntegralNumber() || !id.canConvertToLong()) throw MenuCreateException.invalid();
    var status = text(node, "status", true);
    MenuStatus state;
    try {
      state = MenuStatus.valueOf(status);
    } catch (IllegalArgumentException exception) {
      throw MenuCreateException.invalid();
    }
    var options = new ArrayList<Option>();
    var values = node.path("options");
    if (!values.isMissingNode() && !values.isNull()) {
      if (!values.isArray()) throw MenuCreateException.invalid();
      for (var item : values) {
        fields(item, Set.of("name", "extraPrice", "extraCookTimeSec", "isDefault", "active"));
        options.add(
            new Option(
                text(item, "name", true),
                number(item, "extraPrice"),
                number(item, "extraCookTimeSec"),
                flag(item, "isDefault", false),
                flag(item, "active", true)));
      }
    }
    return new AdminMenuCreateRequest(
        id.longValue(),
        text(node, "name", true),
        text(node, "description", false),
        text(node, "imageUrl", false),
        number(node, "basePrice"),
        number(node, "cookTimeSec"),
        state,
        options);
  }

  private static void fields(JsonNode node, Set<String> allowed) {
    if (node == null || !node.isObject()) throw MenuCreateException.invalid();
    for (var field : node.propertyNames()) {
      if (!allowed.contains(field)) throw MenuCreateException.invalid();
    }
  }

  private static String text(JsonNode node, String name, boolean required) {
    var value = node.path(name);
    if (!required && (value.isMissingNode() || value.isNull())) return null;
    if (!value.isString()) throw MenuCreateException.invalid();
    return value.asString();
  }

  private static Integer number(JsonNode node, String name) {
    var value = node.path(name);
    if (!value.isIntegralNumber() || !value.canConvertToInt()) throw MenuCreateException.invalid();
    return value.intValue();
  }

  private static Boolean flag(JsonNode node, String name, boolean fallback) {
    var value = node.path(name);
    if (value.isMissingNode() || value.isNull()) return fallback;
    if (!value.isBoolean()) throw MenuCreateException.invalid();
    return value.booleanValue();
  }
}
