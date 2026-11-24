package com.peakorder.menu.dto;

import static org.assertj.core.api.Assertions.*;

import com.peakorder.menu.exception.MenuUpdateException;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import tools.jackson.databind.ObjectMapper;

class MenuUpdateRequestTests {
  private final ObjectMapper mapper = new ObjectMapper();

  @Test
  void preservesPresenceNullAndCopiesInputAndOutput() throws Exception {
    var json = mapper.readTree("{\"description\":null}");
    var request = MenuUpdateRequest.parse(json);
    assertThat(request.changes().has("description")).isTrue();
    assertThat(request.changes().get("description").isNull()).isTrue();
    assertThat(request.changes().has("name")).isFalse();
    ((tools.jackson.databind.node.ObjectNode) json).put("name", "changed");
    ((tools.jackson.databind.node.ObjectNode) request.changes()).put("name", "changed");
    assertThat(request.changes().has("name")).isFalse();
  }

  static Stream<String> invalid() {
    return Stream.of(
        "null",
        "[]",
        "{}",
        "{\"status\":\"PAUSED\"}",
        "{\"name\":null}",
        "{\"name\":\" \"}",
        "{\"name\":1}",
        "{\"categoryId\":null}",
        "{\"categoryId\":0}",
        "{\"categoryId\":\"1\"}",
        "{\"categoryId\":9223372036854775808}",
        "{\"basePrice\":null}",
        "{\"basePrice\":-1}",
        "{\"basePrice\":1.0}",
        "{\"basePrice\":2147483648}",
        "{\"cookTimeSec\":true}",
        "{\"description\":7}",
        "{\"imageUrl\":false}",
        "{\"options\":null}",
        "{\"options\":[]}",
        "{\"options\":{}}",
        "{\"options\":[null]}",
        "{\"options\":[{}]}",
        "{\"options\":[{\"optionId\":1}]}",
        "{\"options\":[{\"optionId\":null,\"active\":false}]}",
        "{\"options\":[{\"optionId\":1,\"active\":null}]}",
        "{\"options\":[{\"optionId\":1,\"isDefault\":\"true\"}]}",
        "{\"options\":[{\"optionId\":1,\"active\":false},{\"optionId\":1,\"name\":\"x\"}]}",
        "{\"options\":[{\"name\":\"x\",\"extraPrice\":0}]}",
        "{\"options\":[{\"optionId\":1,\"extraCookTimeSec\":-1}]}",
        "{\"name\":\"" + "x".repeat(256) + "\"}",
        "{\"imageUrl\":\"" + "x".repeat(256) + "\"}",
        "{\"description\":\"bad\\u0000text\"}",
        "{\"options\":[{\"optionId\":1,\"unknown\":1}]}");
  }

  @ParameterizedTest
  @MethodSource("invalid")
  void rejectsInvalidPatch(String body) throws Exception {
    var json = mapper.readTree(body);
    assertThatThrownBy(() -> MenuUpdateRequest.parse(json)).isInstanceOf(MenuUpdateException.class);
  }

  @Test
  void acceptsBoundariesAndOptionalNullOnlyForClearableFields() throws Exception {
    var request =
        MenuUpdateRequest.parse(
            mapper.readTree(
                "{\"name\":\""
                    + "😀".repeat(255)
                    + "\",\"categoryId\":9223372036854775807,\"basePrice\":2147483647,\"cookTimeSec\":0,\"imageUrl\":null,\"description\":null,\"options\":[]}"));
    assertThat(request.changes().get("basePrice").intValue()).isEqualTo(Integer.MAX_VALUE);
  }
}
