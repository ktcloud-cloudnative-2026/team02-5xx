package com.peakorder.menu;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.peakorder.menu.entity.*;
import com.peakorder.menu.repository.*;
import com.peakorder.menu.service.MenuUpdateAuthorization;
import java.net.URI;
import java.net.http.*;
import java.util.Optional;
import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.util.ReflectionTestUtils;
import tools.jackson.databind.ObjectMapper;

@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties =
        "spring.autoconfigure.exclude=org.springframework.boot.jdbc.autoconfigure.DataSourceAutoConfiguration")
class MenuUpdateHttpTests {
  @LocalServerPort int port;
  @MockitoBean MenuRepository menus;
  @MockitoBean MenuOptionRepository options;
  @MockitoBean CategoryRepository categories;
  @MockitoBean MenuUpdateAuthorization authorization;
  private final ObjectMapper mapper = new ObjectMapper();

  @BeforeEach
  void setup() {
    var menu = new Menu(new Category("c", 0), "old", null, null, 10, 20, MenuStatus.PAUSED);
    ReflectionTestUtils.setField(menu, "id", 1L);
    when(menus.findForInformationUpdate(1L)).thenReturn(Optional.of(menu));
  }

  private HttpResponse<String> patch(String id, String body) throws Exception {
    return HttpClient.newHttpClient()
        .send(
            HttpRequest.newBuilder(
                    URI.create("http://localhost:" + port + "/api/v1/admin/menus/" + id))
                .header("Content-Type", "application/json")
                .method("PATCH", HttpRequest.BodyPublishers.ofString(body))
                .build(),
            HttpResponse.BodyHandlers.ofString());
  }

  @Test
  void simulatedAuthorizationAllowsPartialUpdateAndOptionAdd() throws Exception {
    var response =
        patch(
            "1",
            "{\"description\":null,\"basePrice\":0,\"options\":[{\"name\":\"new\",\"extraPrice\":0,\"extraCookTimeSec\":0}]}");
    assertThat(response.statusCode()).isEqualTo(200);
    var node = mapper.readTree(response.body());
    assertThat(node.path("success").asBoolean()).isTrue();
    assertThat(node.path("data").path("menuId").asLong()).isEqualTo(1);
    verify(options).saveAllAndFlush(any());
  }

  @ParameterizedTest
  @ValueSource(strings = {"0", "-1", "text", "1.0", "9223372036854775808"})
  void invalidIdsAre400(String id) throws Exception {
    error(patch(id, "{\"name\":\"x\"}"), 400, "INVALID_REQUEST");
    verifyNoInteractions(menus, categories, options);
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "",
        "{",
        "null",
        "[]",
        "{}",
        "{\"status\":\"ON_SALE\"}",
        "{\"name\":null}",
        "{\"basePrice\":\"1\"}",
        "{\"name\":\"x\",\"name\":\"y\"}",
        "{\"name\":\"x\"} {}",
        "{\"options\":null}",
        "{\"options\":[]}"
      })
  void invalidPatchDoesNotQueryOrWrite(String json) throws Exception {
    error(patch("1", json), 400, "INVALID_REQUEST");
    verifyNoInteractions(menus, categories, options);
  }

  @Test
  void missingMenuCategoryAndOptionHaveScoped404() throws Exception {
    error(patch("2", "{\"name\":\"x\"}"), 404, "MENU_NOT_FOUND");
    error(patch("1", "{\"categoryId\":2}"), 404, "CATEGORY_NOT_FOUND");
    error(
        patch("1", "{\"options\":[{\"optionId\":99,\"active\":false}]}"), 404, "OPTION_NOT_FOUND");
    verify(menus, never()).flush();
  }

  @Test
  void internalErrorDoesNotLeakDetails() throws Exception {
    doThrow(new DataAccessResourceFailureException("SQL password=private")).when(menus).flush();
    var response = patch("1", "{\"name\":\"x\"}");
    error(response, 500, "INTERNAL_ERROR");
    assertThat(response.body()).doesNotContain("SQL", "password", "private");
  }

  @Test
  void openApiDescribesPatchPresenceAndResponsesWithoutSalesStatus() throws Exception {
    var response =
        HttpClient.newHttpClient()
            .send(
                HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/v3/api-docs"))
                    .GET()
                    .build(),
                HttpResponse.BodyHandlers.ofString());
    assertThat(response.statusCode()).isEqualTo(200);
    var document = mapper.readTree(response.body());
    var operation = document.path("paths").path("/api/v1/admin/menus/{menuId}").path("patch");
    assertThat(operation.path("summary").asString()).contains("disabled");
    for (String code : new String[] {"200", "400", "403", "404", "500"})
      assertThat(operation.path("responses").has(code)).isTrue();
    var schema = document.path("components").path("schemas").path("MenuUpdateDocument");
    assertThat(schema.path("properties").has("status")).isFalse();
    assertThat(schema.path("properties").has("options")).isTrue();
    assertThat(document.path("components").path("schemas").toString())
        .contains("optionId", "menuId", "isDefault", "active");
  }

  private void error(HttpResponse<String> response, int status, String code) throws Exception {
    assertThat(response.statusCode()).isEqualTo(status);
    var node = mapper.readTree(response.body());
    assertThat(node.path("success").asBoolean()).isFalse();
    assertThat(node.path("errorCode").asString()).isEqualTo(code);
    assertThat(node.has("data")).isFalse();
  }
}
