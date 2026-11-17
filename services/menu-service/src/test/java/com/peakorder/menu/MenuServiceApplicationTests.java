package com.peakorder.menu;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

import com.peakorder.menu.entity.Menu;
import com.peakorder.menu.entity.MenuOption;
import com.peakorder.menu.entity.MenuStatus;
import com.peakorder.menu.repository.MenuOptionRepository;
import com.peakorder.menu.repository.MenuRepository;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.util.ReflectionTestUtils;
import tools.jackson.databind.ObjectMapper;

@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties =
        "spring.autoconfigure.exclude=org.springframework.boot.jdbc.autoconfigure.DataSourceAutoConfiguration")
class MenuServiceApplicationTests {

  @LocalServerPort private int port;
  @MockitoBean private MenuRepository menus;
  @MockitoBean private MenuOptionRepository options;

  @Test
  void documentsPurchaseValidationEndpoint() throws Exception {
    var response = get("/v3/api-docs");

    assertThat(response.statusCode()).isEqualTo(200);
    var document = new ObjectMapper().readTree(response.body());
    assertThat(document.path("openapi").asString()).startsWith("3.");
    assertThat(document.path("paths").isObject()).isTrue();
    var operation =
        document.path("paths").path("/internal/v1/menus/validate-purchase").path("post");
    assertThat(operation.path("responses").has("200")).isTrue();
    assertThat(operation.path("responses").has("400")).isTrue();
    assertThat(operation.path("responses").has("500")).isTrue();
    assertThat(document.path("components").path("schemas").toString())
        .contains("cookTimeSec", "extraCookTimeSec");
  }

  @Test
  void servesSwaggerUiAndJavascript() throws Exception {
    var page = get("/swagger-ui.html");
    var script = get("/swagger-ui/swagger-ui-bundle.js");

    assertThat(page.statusCode()).isEqualTo(200);
    assertThat(page.body()).contains("Swagger UI", "swagger-ui-bundle.js");
    assertThat(script.statusCode()).isEqualTo(200);
    assertThat(script.body()).contains("SwaggerUIBundle");
  }

  @Test
  void connectsSwaggerUiToLocalOpenApiDocument() throws Exception {
    var response = get("/v3/api-docs/swagger-config");

    assertThat(response.statusCode()).isEqualTo(200);
    var config = new ObjectMapper().readTree(response.body());
    assertThat(config.path("url").asString()).isEqualTo("/v3/api-docs");
  }

  @Test
  void acceptsOrderRequestAndDeserializesResponseWithOrderContract() throws Exception {
    var menu = new Menu(null, "Burger", null, null, 6500, 90, MenuStatus.ON_SALE);
    ReflectionTestUtils.setField(menu, "id", 1L);
    var option = new MenuOption(menu, "Set", 2500, 30, false, true);
    ReflectionTestUtils.setField(option, "id", 3L);
    when(menus.findAllById(any())).thenReturn(List.of(menu));
    when(options.findAllById(any())).thenReturn(List.of(option));
    var response = post("{\"items\":[{\"menuId\":1,\"quantity\":2,\"optionIds\":[3]}]}");
    assertThat(response.statusCode()).isEqualTo(200);
    var envelope = new ObjectMapper().readValue(response.body(), OrderEnvelope.class);
    assertThat(envelope.success()).isTrue();
    assertThat(envelope.message()).isEqualTo("OK");
    var item = envelope.data().items().getFirst();
    assertThat(item.menuId()).isEqualTo(1L);
    assertThat(item.menuName()).isEqualTo("Burger");
    assertThat(item.unitPrice()).isEqualTo(6500);
    assertThat(item.cookTimeSec()).isEqualTo(90);
    assertThat(item.options()).containsExactly(new ValidatedOption(3L, "Set", 2500, 30));
    assertThat(response.body()).doesNotContain("errorCode");
  }

  // Exact field names and numeric types from PR #46 MenuClient/HttpMenuClient.
  record OrderEnvelope(boolean success, ValidationData data, String message, String errorCode) {}

  record ValidationData(List<ValidatedMenu> items) {}

  record ValidatedMenu(
      Long menuId,
      String menuName,
      int unitPrice,
      Integer cookTimeSec,
      List<ValidatedOption> options) {}

  record ValidatedOption(
      Long optionId, String optionName, int extraPrice, Integer extraCookTimeSec) {}

  @ParameterizedTest
  @ValueSource(strings = {
    "", "null", "{", "{}", "{\"items\":[]}", "{\"items\":[null]}",
    "{\"items\":[{\"menuId\":1,\"optionIds\":[]}]}",
    "{\"items\":[{\"menuId\":1,\"quantity\":0,\"optionIds\":[]}]}",
    "{\"items\":[{\"menuId\":1,\"quantity\":2147483648,\"optionIds\":[]}]}",
    "{\"items\":[{\"menuId\":\"bad\",\"quantity\":1,\"optionIds\":[]}]}",
    "{\"items\":[{\"menuId\":1,\"quantity\":1,\"optionIds\":[1,1]}]}"
  })
  void invalidJsonAndFieldsUseCommonErrorEnvelope(String body) throws Exception {
    var response = post(body);
    assertThat(response.statusCode()).isEqualTo(400);
    var json = new ObjectMapper().readTree(response.body());
    assertThat(json.path("success").asBoolean()).isFalse();
    assertThat(json.path("errorCode").asString()).isEqualTo("INVALID_REQUEST");
    assertThat(json.path("message").asString()).isNotBlank();
  }

  @ParameterizedTest
  @ValueSource(strings = {"1.5", "\"1\"", "true", "[]", "{}", "9223372036854775808"})
  void rejectsNonIntegerIdentifiers(String value) throws Exception {
    var response =
        post("{\"items\":[{\"menuId\":" + value + ",\"quantity\":1,\"optionIds\":[]}]}");
    assertThat(response.statusCode()).isEqualTo(400);
    assertThat(response.body()).contains("INVALID_REQUEST");
  }

  @ParameterizedTest
  @ValueSource(strings = {"1.5", "\"2\"", "true"})
  void rejectsNonIntegerQuantity(String value) throws Exception {
    var response =
        post("{\"items\":[{\"menuId\":1,\"quantity\":" + value + ",\"optionIds\":[]}]}");
    assertThat(response.statusCode()).isEqualTo(400);
    assertThat(response.body()).contains("INVALID_REQUEST");
  }

  @ParameterizedTest
  @ValueSource(strings = {
    "MISSING_MENU", "PAUSED", "HIDDEN", "MISSING_OPTION", "INACTIVE_OPTION", "FOREIGN_OPTION"
  })
  void businessValidationFailuresRemainClientErrors(String scenario) throws Exception {
    var status = switch (scenario) {
      case "PAUSED" -> MenuStatus.PAUSED;
      case "HIDDEN" -> MenuStatus.HIDDEN;
      default -> MenuStatus.ON_SALE;
    };
    var menu = new Menu(null, "Burger", null, null, 6500, 90, status);
    ReflectionTestUtils.setField(menu, "id", 1L);
    when(menus.findAllById(any()))
        .thenReturn(scenario.equals("MISSING_MENU") ? List.of() : List.of(menu));
    if (scenario.equals("INACTIVE_OPTION") || scenario.equals("FOREIGN_OPTION")) {
      var owner = menu;
      if (scenario.equals("FOREIGN_OPTION")) {
        owner = new Menu(null, "Other menu", null, null, 6500, 90, MenuStatus.ON_SALE);
        ReflectionTestUtils.setField(owner, "id", 2L);
      }
      var option =
          new MenuOption(owner, "Set", 2500, 30, false, !scenario.equals("INACTIVE_OPTION"));
      ReflectionTestUtils.setField(option, "id", 3L);
      when(options.findAllById(any())).thenReturn(List.of(option));
    } else {
      when(options.findAllById(any())).thenReturn(List.of());
    }
    var response = post("{\"items\":[{\"menuId\":1,\"quantity\":1,\"optionIds\":[3]}]}");
    assertThat(response.statusCode()).isEqualTo(400);
    var json = new ObjectMapper().readTree(response.body());
    assertThat(json.path("success").asBoolean()).isFalse();
    assertThat(json.path("errorCode").asString()).isEqualTo("INVALID_REQUEST");
    assertThat(response.body()).doesNotContain("INTERNAL_ERROR");
  }

  @Test
  void internalFailuresDoNotExposeDatabaseDetails() throws Exception {
    when(menus.findAllById(any()))
        .thenThrow(new IllegalStateException("private database connection detail"));
    var response = post("{\"items\":[{\"menuId\":1,\"quantity\":1,\"optionIds\":[]}]}");
    assertThat(response.statusCode()).isEqualTo(500);
    assertThat(response.body()).contains("INTERNAL_ERROR").doesNotContain("private database");
  }

  private HttpResponse<String> post(String body) throws Exception {
    try (var client = HttpClient.newHttpClient()) {
      var request =
          HttpRequest.newBuilder(
                  URI.create("http://localhost:" + port + "/internal/v1/menus/validate-purchase"))
              .timeout(Duration.ofSeconds(15))
              .header("Content-Type", "application/json")
              .POST(HttpRequest.BodyPublishers.ofString(body))
              .build();
      return client.send(request, HttpResponse.BodyHandlers.ofString());
    }
  }

  private HttpResponse<String> get(String path) throws Exception {
    try (var client = HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NORMAL).build()) {
      var request =
          HttpRequest.newBuilder(URI.create("http://localhost:" + port + path))
              .timeout(Duration.ofSeconds(15))
              .GET()
              .build();
      return client.send(request, HttpResponse.BodyHandlers.ofString());
    }
  }
}
