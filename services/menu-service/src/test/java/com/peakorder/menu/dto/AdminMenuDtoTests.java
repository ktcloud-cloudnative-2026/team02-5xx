package com.peakorder.menu.dto;

import static org.assertj.core.api.Assertions.assertThat;

import com.peakorder.menu.entity.MenuStatus;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;

class AdminMenuDtoTests {
  private final ObjectMapper mapper = new ObjectMapper();

  @Test
  void listCanUseExistingEnvelopeWithCookingTimeAndNullImage() throws Exception {
    var data =
        new AdminMenuList(
            List.of(new AdminMenuList.CategoryItem(1L, "Category")),
            List.of(new AdminMenuList.MenuItem(2L, 1L, "Hidden", null, 0, 90, MenuStatus.HIDDEN)));
    var json = mapper.readTree(mapper.writeValueAsString(ApiResponse.ok(data)));
    assertThat(json.path("success").asBoolean()).isTrue();
    assertThat(json.path("message").asString()).isEqualTo("OK");
    assertThat(json.has("errorCode")).isFalse();
    var item = json.path("data").path("menus").get(0);
    assertThat(item.path("status").asString()).isEqualTo("HIDDEN");
    assertThat(item.path("cookTimeSec").asInt()).isEqualTo(90);
    assertThat(item.has("imageUrl")).isTrue();
    assertThat(item.path("imageUrl").isNull()).isTrue();
    assertThat(item.size()).isEqualTo(7);
  }

  @Test
  void detailPreservesOptionNamesTimesTimestampsAndNullableFields() throws Exception {
    var timestamp = Instant.parse("2026-11-01T00:00:00Z");
    var data =
        new AdminMenuDetail(
            2L,
            1L,
            "Hidden",
            null,
            null,
            0,
            90,
            MenuStatus.HIDDEN,
            timestamp,
            timestamp,
            List.of(new AdminMenuDetail.Option(3L, "Inactive", 100, 30, true, false)));
    var json = mapper.readTree(mapper.writeValueAsString(ApiResponse.ok(data))).path("data");
    assertThat(json.has("createdAt")).isTrue();
    assertThat(json.has("updatedAt")).isTrue();
    assertThat(json.has("description")).isTrue();
    assertThat(json.path("description").isNull()).isTrue();
    assertThat(json.path("imageUrl").isNull()).isTrue();
    assertThat(json.size()).isEqualTo(11);
    assertThat(json.path("options").get(0))
        .isEqualTo(
            mapper.readTree(
                "{\"id\":3,\"name\":\"Inactive\",\"extraPrice\":100,\"extraCookTimeSec\":30,\"isDefault\":true,\"active\":false}"));
    assertThat(json.has("stockQty")).isFalse();
  }
}
