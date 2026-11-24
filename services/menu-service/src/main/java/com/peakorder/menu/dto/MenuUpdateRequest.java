package com.peakorder.menu.dto;

import com.peakorder.menu.exception.MenuUpdateException;
import io.swagger.v3.oas.annotations.media.Schema;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import tools.jackson.databind.JsonNode;

/** Validated immutable-by-copy PATCH document, preserving absent versus explicit null. */
public final class MenuUpdateRequest {
  private final JsonNode changes;

  private MenuUpdateRequest(JsonNode changes) {
    this.changes = changes.deepCopy();
  }

  public JsonNode changes() {
    return changes.deepCopy();
  }

  public static MenuUpdateRequest parse(JsonNode node) {
    fields(
        node,
        Set.of(
            "name",
            "categoryId",
            "description",
            "imageUrl",
            "basePrice",
            "cookTimeSec",
            "options"));
    if (node.isEmpty()) throw MenuUpdateException.invalid();
    validateValues(node);
    if (node.has("categoryId")) positive(node.get("categoryId"));
    if (node.has("options")) {
      var options = node.get("options");
      if (!options.isArray()) throw MenuUpdateException.invalid();
      if (node.size() == 1 && options.isEmpty()) throw MenuUpdateException.invalid();
      Set<Long> ids = new HashSet<>();
      for (var option : options) {
        fields(
            option,
            Set.of("optionId", "name", "extraPrice", "extraCookTimeSec", "isDefault", "active"));
        if (option.has("optionId")) {
          long id = positive(option.get("optionId"));
          if (!ids.add(id) || option.size() == 1) throw MenuUpdateException.invalid();
        } else if (!option.has("name")
            || !option.has("extraPrice")
            || !option.has("extraCookTimeSec")) throw MenuUpdateException.invalid();
        validateValues(option);
        for (String flag : List.of("isDefault", "active"))
          if (option.has(flag) && !option.get(flag).isBoolean())
            throw MenuUpdateException.invalid();
      }
    }
    return new MenuUpdateRequest(node);
  }

  private static void fields(JsonNode node, Set<String> allowed) {
    if (node == null || !node.isObject()) throw MenuUpdateException.invalid();
    for (String key : node.propertyNames())
      if (!allowed.contains(key)) throw MenuUpdateException.invalid();
  }

  private static void validateValues(JsonNode node) {
    if (node.has("name")) text(node.get("name"), false, true, 255);
    if (node.has("description")) text(node.get("description"), true, false, Integer.MAX_VALUE);
    if (node.has("imageUrl")) text(node.get("imageUrl"), true, false, 255);
    for (String key : List.of("basePrice", "cookTimeSec", "extraPrice", "extraCookTimeSec"))
      if (node.has(key)) {
        var value = node.get(key);
        if (!value.isIntegralNumber() || !value.canConvertToInt() || value.intValue() < 0)
          throw MenuUpdateException.invalid();
      }
  }

  private static void text(JsonNode value, boolean nullable, boolean nonblank, int max) {
    if (nullable && value.isNull()) return;
    if (!value.isString()) throw MenuUpdateException.invalid();
    String text = value.asString();
    if ((nonblank && text.isBlank())
        || text.codePointCount(0, text.length()) > max
        || text.indexOf('\0') >= 0) throw MenuUpdateException.invalid();
  }

  private static long positive(JsonNode value) {
    if (!value.isIntegralNumber() || !value.canConvertToLong() || value.longValue() <= 0)
      throw MenuUpdateException.invalid();
    return value.longValue();
  }

  /** Documentation schema only: runtime validation uses presence-aware parse(). */
  @Schema(
      name = "MenuUpdateDocument",
      description =
          "All fields optional; description/imageUrl null clears. Empty changes and status are rejected.")
  public record Document(
      @Schema(minimum = "1") Long categoryId,
      @Schema(maxLength = 255) String name,
      @Schema(nullable = true) String description,
      @Schema(nullable = true, maxLength = 255) String imageUrl,
      @Schema(minimum = "0") Integer basePrice,
      @Schema(minimum = "0") Integer cookTimeSec,
      List<OptionDocument> options) {}

  @Schema(
      name = "MenuUpdateOptionDocument",
      description =
          "optionId selects an existing owned option; omission adds a new option requiring name/extraPrice/extraCookTimeSec. Omitted existing options are preserved.")
  public record OptionDocument(
      @Schema(minimum = "1") Long optionId,
      @Schema(maxLength = 255) String name,
      @Schema(minimum = "0") Integer extraPrice,
      @Schema(minimum = "0") Integer extraCookTimeSec,
      @Schema(description = "New option default false; existing omission preserves")
          Boolean isDefault,
      @Schema(description = "New option default true; existing omission preserves")
          Boolean active) {}
}
