package com.peakorder.menu.dto;

import static org.assertj.core.api.Assertions.*;

import com.peakorder.menu.exception.MenuCreateException;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import tools.jackson.databind.ObjectMapper;

class AdminMenuCreateDtoTests {
  private final ObjectMapper mapper = new ObjectMapper();
  private static final String VALID =
      "\"categoryId\":1,\"name\":\"Burger\",\"basePrice\":0,\"cookTimeSec\":0,\"status\":\"ON_SALE\"";

  @Test
  void parsesOptionalFieldsAndBooleanDefaultsAndSerializesEnvelope() throws Exception {
    var request =
        AdminMenuCreateRequest.fromJson(
            mapper.readTree(
                "{"
                    + VALID
                    + ",\"options\":[{\"name\":\"Set\",\"extraPrice\":0,\"extraCookTimeSec\":0}]}"));
    assertThat(request.options()).hasSize(1);
    assertThat(request.options().getFirst().isDefault()).isFalse();
    assertThat(request.options().getFirst().active()).isTrue();
    assertThat(request.description()).isNull();
    assertThat(
            mapper
                .readTree(mapper.writeValueAsString(ApiResponse.ok(new AdminMenuCreated(8L))))
                .path("data")
                .path("menuId")
                .asLong())
        .isEqualTo(8);
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "null",
        "[]",
        "{}",
        "{\"categoryId\":\"1\"}",
        "{\"categoryId\":1.0}",
        "{\"categoryId\":9223372036854775808}"
      })
  void rejectsInvalidRootAndCategoryTypes(String json) throws Exception {
    var node = mapper.readTree(json);
    assertThatThrownBy(() -> AdminMenuCreateRequest.fromJson(node))
        .isInstanceOf(MenuCreateException.class);
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "\"unexpected\":1",
        "\"options\":{}",
        "\"options\":[null]",
        "\"options\":[{}]",
        "\"options\":[{\"name\":\"x\",\"extraPrice\":0,\"extraCookTimeSec\":0,\"active\":\"true\"}]"
      })
  void rejectsUnknownFieldsAndBadOptions(String suffix) throws Exception {
    var node = mapper.readTree("{" + VALID + "," + suffix + "}");
    assertThatThrownBy(() -> AdminMenuCreateRequest.fromJson(node))
        .isInstanceOf(MenuCreateException.class);
  }

  @ParameterizedTest
  @ValueSource(strings = {"\"1\"", "1.5", "true", "2147483648", "null"})
  void rejectsCoercionAndOverflow(String value) throws Exception {
    var node =
        mapper.readTree(("{" + VALID + "}").replace("\"basePrice\":0", "\"basePrice\":" + value));
    assertThatThrownBy(() -> AdminMenuCreateRequest.fromJson(node))
        .isInstanceOf(MenuCreateException.class);
  }
}
