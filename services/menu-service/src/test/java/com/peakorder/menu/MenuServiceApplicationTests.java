package com.peakorder.menu;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.peakorder.menu.entity.Menu;
import com.peakorder.menu.entity.MenuStatus;
import com.peakorder.menu.repository.MenuRepository;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import tools.jackson.databind.ObjectMapper;

@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties =
        "spring.autoconfigure.exclude=org.springframework.boot.jdbc.autoconfigure.DataSourceAutoConfiguration")
class MenuServiceApplicationTests {

  @LocalServerPort private int port;
  @MockitoBean private MenuRepository menus;

  @Test
  void documentsMenuExistenceEndpoint() throws Exception {
    var response = get("/v3/api-docs");

    assertThat(response.statusCode()).isEqualTo(200);
    var document = new ObjectMapper().readTree(response.body());
    assertThat(document.path("openapi").asString()).startsWith("3.");
    assertThat(document.path("paths").isObject()).isTrue();
    var operation =
        document.path("paths").path("/internal/v1/menus/{menuId}/existence").path("get");
    assertThat(operation.path("responses").has("200")).isTrue();
    assertThat(operation.path("responses").has("400")).isTrue();
    assertThat(operation.path("responses").has("500")).isTrue();
    var schemas = document.path("components").path("schemas");
    var result = schemas.path("MenuExistenceResponse");
    assertThat(result.path("properties").has("menuId")).isTrue();
    assertThat(result.path("properties").has("exists")).isTrue();
    assertThat(result.path("properties").has("status")).isTrue();
    assertThat(result.path("required").toString()).contains("status");
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

  @ParameterizedTest
  @EnumSource(MenuStatus.class)
  void returnsAllStoredStatusesIncludingHidden(MenuStatus status) throws Exception {
    when(menus.findById(1L))
        .thenReturn(Optional.of(new Menu(null, "Menu", null, null, 0, 0, status)));
    var response = get("/internal/v1/menus/1/existence");
    assertThat(response.statusCode()).isEqualTo(200);
    var json = new ObjectMapper().readTree(response.body());
    assertThat(json.path("success").asBoolean()).isTrue();
    assertThat(json.path("message").asString()).isEqualTo("OK");
    assertThat(json.has("errorCode")).isFalse();
    assertThat(json.path("data").path("menuId").asLong()).isEqualTo(1L);
    assertThat(json.path("data").path("exists").asBoolean()).isTrue();
    assertThat(json.path("data").path("status").asString()).isEqualTo(status.name());
  }

  @ParameterizedTest
  @ValueSource(longs = {1, Long.MAX_VALUE})
  void missingMenuReturnsSuccessWithExplicitNullStatus(long id) throws Exception {
    when(menus.findById(id)).thenReturn(Optional.empty());
    var response = get("/internal/v1/menus/" + id + "/existence");
    assertThat(response.statusCode()).isEqualTo(200);
    var json = new ObjectMapper().readTree(response.body());
    assertThat(json.path("success").asBoolean()).isTrue();
    assertThat(json.path("message").asString()).isEqualTo("OK");
    assertThat(json.has("errorCode")).isFalse();
    var data = json.path("data");
    assertThat(data.path("menuId").asLong()).isEqualTo(id);
    assertThat(data.path("exists").asBoolean()).isFalse();
    assertThat(data.has("status")).isTrue();
    assertThat(data.path("status").isNull()).isTrue();
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "0",
        "-1",
        "-9223372036854775808",
        "abc",
        "1.5",
        "9223372036854775808",
        "-9223372036854775809"
      })
  void rejectsInvalidPathIdsWithCommonError(String id) throws Exception {
    var response = get("/internal/v1/menus/" + id + "/existence");
    assertThat(response.statusCode()).isEqualTo(400);
    var json = new ObjectMapper().readTree(response.body());
    assertThat(json.path("success").asBoolean()).isFalse();
    assertThat(json.path("errorCode").asString()).isEqualTo("INVALID_REQUEST");
    assertThat(json.path("message").asString()).isEqualTo("menuId must be a positive Long integer");
    verifyNoInteractions(menus);
  }

  @ParameterizedTest
  @ValueSource(booleans = {true, false})
  void databaseAndUnexpectedFailuresReturnServerError(boolean databaseFailure) throws Exception {
    RuntimeException failure =
        databaseFailure
            ? new DataAccessResourceFailureException("private database detail")
            : new IllegalStateException("private service detail");
    when(menus.findById(1L)).thenThrow(failure);
    var response = get("/internal/v1/menus/1/existence");
    assertThat(response.statusCode()).isEqualTo(500);
    var json = new ObjectMapper().readTree(response.body());
    assertThat(json.path("success").asBoolean()).isFalse();
    assertThat(json.path("errorCode").asString()).isEqualTo("INTERNAL_ERROR");
    assertThat(json.path("message").asString()).isEqualTo("Internal server error");
    assertThat(response.body()).doesNotContain("private", "exists");
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
