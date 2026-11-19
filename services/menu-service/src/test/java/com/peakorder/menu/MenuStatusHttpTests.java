package com.peakorder.menu;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.peakorder.menu.entity.MenuStatus;
import com.peakorder.menu.repository.*;
import com.peakorder.menu.service.MenuStatusAuthorization;
import java.net.URI;
import java.net.http.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.*;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import tools.jackson.databind.ObjectMapper;

@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties =
        "spring.autoconfigure.exclude=org.springframework.boot.jdbc.autoconfigure.DataSourceAutoConfiguration")
class MenuStatusHttpTests {
  @LocalServerPort int port;
  @MockitoBean MenuRepository menus;
  @MockitoBean MenuOptionRepository options;
  @MockitoBean MenuStatusRepository writes;
  @MockitoBean MenuStatusAuthorization authorization;
  private final ObjectMapper mapper = new ObjectMapper();

  @BeforeEach
  void setup() {
    when(writes.changeIfDifferent(eq(1L), anyString())).thenReturn(1);
  }

  private HttpResponse<String> patch(String id, String body) throws Exception {
    return HttpClient.newHttpClient()
        .send(
            HttpRequest.newBuilder(
                    URI.create(
                        "http://localhost:" + port + "/api/v1/admin/menus/" + id + "/status"))
                .header("Content-Type", "application/json")
                .method("PATCH", HttpRequest.BodyPublishers.ofString(body))
                .build(),
            HttpResponse.BodyHandlers.ofString());
  }

  @ParameterizedTest
  @EnumSource(MenuStatus.class)
  void simulatedAuthorizationAllowsEveryState(MenuStatus status) throws Exception {
    var response = patch("1", "{\"status\":\"" + status + "\"}");
    assertThat(response.statusCode()).isEqualTo(200);
    var node = mapper.readTree(response.body());
    assertThat(node.path("success").asBoolean()).isTrue();
    assertThat(node.path("data").path("menuId").asLong()).isEqualTo(1);
    assertThat(node.path("data").path("status").asString()).isEqualTo(status.name());
    verifyNoInteractions(options);
  }

  @Test
  void sameStateIsSuccessful() throws Exception {
    when(writes.changeIfDifferent(1L, "HIDDEN")).thenReturn(0);
    when(menus.existsById(1L)).thenReturn(true);
    assertThat(patch("1", "{\"status\":\"HIDDEN\"}").statusCode()).isEqualTo(200);
  }

  @ParameterizedTest
  @ValueSource(strings = {"0", "-1", "text", "1.0", "9223372036854775808"})
  void rejectsInvalidIdsBeforeDatabaseAccess(String id) throws Exception {
    error(patch(id, "{\"status\":\"PAUSED\"}"), 400, "INVALID_REQUEST");
    verifyNoInteractions(menus, writes, options);
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "",
        "{",
        "null",
        "[]",
        "{}",
        "{\"status\":null}",
        "{\"status\":1}",
        "{\"status\":\"on_sale\"}",
        "{\"status\":\" ON_SALE \"}",
        "{\"status\":\"PAUSED\",\"name\":\"x\"}",
        "{\"status\":\"ON_SALE\",\"status\":\"HIDDEN\"}",
        "{\"status\":\"ON_SALE\"} {}"
      })
  void rejectsInvalidJsonAndDuplicateKeys(String body) throws Exception {
    error(patch("1", body), 400, "INVALID_REQUEST");
    verifyNoInteractions(menus, writes, options);
  }

  @Test
  void missingMenuIs404() throws Exception {
    error(patch("2", "{\"status\":\"PAUSED\"}"), 404, "MENU_NOT_FOUND");
  }

  @Test
  void databaseFailureDoesNotLeakDetails() throws Exception {
    doThrow(new DataAccessResourceFailureException("SQL password=private"))
        .when(writes)
        .changeIfDifferent(1L, "PAUSED");
    var response = patch("1", "{\"status\":\"PAUSED\"}");
    error(response, 500, "INTERNAL_ERROR");
    assertThat(response.body()).doesNotContain("SQL", "password", "private");
  }

  @Test
  void openApiDescribesDisabledStatusRouteAndRequiredEnum() throws Exception {
    var response =
        HttpClient.newHttpClient()
            .send(
                HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/v3/api-docs"))
                    .GET()
                    .build(),
                HttpResponse.BodyHandlers.ofString());
    assertThat(response.statusCode()).isEqualTo(200);
    var document = mapper.readTree(response.body());
    var operation =
        document.path("paths").path("/api/v1/admin/menus/{menuId}/status").path("patch");
    assertThat(operation.path("summary").asString()).contains("disabled");
    for (String code : new String[] {"200", "400", "403", "404", "500"})
      assertThat(operation.path("responses").has(code)).isTrue();
    var schema = document.path("components").path("schemas").path("MenuStatusRequest");
    assertThat(schema.path("required").toString()).contains("status");
    assertThat(schema.toString()).contains("ON_SALE", "PAUSED", "HIDDEN");
    assertThat(document.path("components").path("schemas").toString()).contains("menuId");
  }

  private void error(HttpResponse<String> response, int status, String code) throws Exception {
    assertThat(response.statusCode()).isEqualTo(status);
    var json = mapper.readTree(response.body());
    assertThat(json.path("success").asBoolean()).isFalse();
    assertThat(json.path("errorCode").asString()).isEqualTo(code);
    assertThat(json.has("data")).isFalse();
  }
}
