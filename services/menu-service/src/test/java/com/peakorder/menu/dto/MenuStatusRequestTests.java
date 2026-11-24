package com.peakorder.menu.dto;

import static org.assertj.core.api.Assertions.*;

import com.peakorder.menu.entity.MenuStatus;
import com.peakorder.menu.exception.MenuStatusChangeException;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.*;
import tools.jackson.databind.ObjectMapper;

class MenuStatusRequestTests {
  private final ObjectMapper mapper = new ObjectMapper();

  @ParameterizedTest
  @EnumSource(MenuStatus.class)
  void acceptsExactlyEachStateAndSerializesResult(MenuStatus state) throws Exception {
    assertThat(MenuStatusRequest.parse(mapper.readTree("{\"status\":\"" + state + "\"}")).status())
        .isEqualTo(state);
    var body =
        mapper.readTree(
            mapper.writeValueAsString(ApiResponse.ok(new MenuStatusChanged(1L, state))));
    assertThat(body.path("data").path("status").asString()).isEqualTo(state.name());
    assertThat(body.path("data").path("menuId").asLong()).isEqualTo(1);
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "null",
        "{}",
        "[]",
        "\"ON_SALE\"",
        "{\"status\":null}",
        "{\"status\":1}",
        "{\"status\":true}",
        "{\"status\":[]}",
        "{\"status\":{}}",
        "{\"status\":\"\"}",
        "{\"status\":\"on_sale\"}",
        "{\"status\":\" ON_SALE \"}",
        "{\"status\":\"DELETED\"}",
        "{\"status\":\"HIDDEN\",\"name\":\"x\"}",
        "{\"state\":\"PAUSED\"}"
      })
  void rejectsMissingOrInvalidStateAndUnknownFields(String body) throws Exception {
    var json = mapper.readTree(body);
    assertThatThrownBy(() -> MenuStatusRequest.parse(json))
        .isInstanceOf(MenuStatusChangeException.class);
  }
}
