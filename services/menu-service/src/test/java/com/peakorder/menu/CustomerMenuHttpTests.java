package com.peakorder.menu;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

import com.peakorder.menu.entity.Category;
import com.peakorder.menu.entity.Menu;
import com.peakorder.menu.entity.MenuOption;
import com.peakorder.menu.entity.MenuStatus;
import com.peakorder.menu.repository.AdminMenuQueryRepository;
import com.peakorder.menu.repository.CategoryRepository;
import com.peakorder.menu.repository.MenuOptionRepository;
import com.peakorder.menu.repository.MenuRepository;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.util.ReflectionTestUtils;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties =
        "spring.autoconfigure.exclude=org.springframework.boot.jdbc.autoconfigure.DataSourceAutoConfiguration")
class CustomerMenuHttpTests {
  @LocalServerPort private int port;
  @MockitoBean private MenuRepository menus;
  @MockitoBean private CategoryRepository categories;
  @MockitoBean private MenuOptionRepository options;
  @MockitoBean private AdminMenuQueryRepository adminMenus;
  private final ObjectMapper mapper = new ObjectMapper();

  private Menu menu(MenuStatus status) {
    var category = new Category("Burgers", 0);
    ReflectionTestUtils.setField(category, "id", 2L);
    var menu = new Menu(category, "Classic Burger", null, null, 6500, 90, status);
    ReflectionTestUtils.setField(menu, "id", 10L);
    return menu;
  }

  @Test
  void anonymousListReturnsCategoriesAndExactMenuContract() throws Exception {
    var menu = menu(MenuStatus.PAUSED);
    var emptyCategory = new Category("Empty", 1);
    ReflectionTestUtils.setField(emptyCategory, "id", 3L);
    when(categories.findAll()).thenReturn(List.of(emptyCategory, menu.getCategory()));
    when(menus.findByStatusIn(any())).thenReturn(List.of(menu));
    var response = get("/api/v1/menus?categoryId=2&query=%20bURGer%20&sort=priceAsc");
    assertThat(response.statusCode()).isEqualTo(200);
    var json = mapper.readTree(response.body());
    assertThat(json.path("success").asBoolean()).isTrue();
    assertThat(json.path("message").asString()).isEqualTo("OK");
    assertThat(json.has("errorCode")).isFalse();
    var data = json.path("data");
    assertThat(data.path("categories").size()).isEqualTo(2);
    assertThat(data.path("categories").get(0).path("id").asLong()).isEqualTo(2L);
    assertThat(data.path("menus").get(0))
        .isEqualTo(
            mapper.readTree(
                "{\"id\":10,\"categoryId\":2,\"name\":\"Classic Burger\",\"imageUrl\":null,\"basePrice\":6500,\"status\":\"PAUSED\"}"));
    verify(menus).findByStatusIn(List.of(MenuStatus.ON_SALE, MenuStatus.PAUSED));
    verifyNoInteractions(options);
  }

  @ParameterizedTest
  @ValueSource(
      strings = {"", "?categoryId=9223372036854775807", "?query=%20%20", "?query=unmatched"})
  void validEmptyListsReturn200(String query) throws Exception {
    var response = get("/api/v1/menus" + query);
    assertThat(response.statusCode()).isEqualTo(200);
    assertThat(mapper.readTree(response.body()).path("data").path("menus").isEmpty()).isTrue();
  }

  @ParameterizedTest
  @EnumSource(
      value = MenuStatus.class,
      names = {"ON_SALE", "PAUSED"})
  void detailPreservesNullableFieldsAndOptionBooleanNames(MenuStatus status) throws Exception {
    var menu = menu(status);
    var option = new MenuOption(menu, "Set", 2500, 30, true, false);
    ReflectionTestUtils.setField(option, "id", 31L);
    when(menus.findById(10L)).thenReturn(Optional.of(menu));
    when(options.findByMenuIdOrderByIdAsc(10L)).thenReturn(List.of(option));
    var response = get("/api/v1/menus/10");
    assertThat(response.statusCode()).isEqualTo(200);
    var data = mapper.readTree(response.body()).path("data");
    assertThat(data.size()).isEqualTo(8);
    assertThat(data.path("status").asString()).isEqualTo(status.name());
    assertThat(data.has("description")).isTrue();
    assertThat(data.path("description").isNull()).isTrue();
    assertThat(data.has("imageUrl")).isTrue();
    assertThat(data.path("imageUrl").isNull()).isTrue();
    assertThat(data.path("options").get(0))
        .isEqualTo(
            mapper.readTree(
                "{\"id\":31,\"name\":\"Set\",\"extraPrice\":2500,\"isDefault\":true,\"active\":false}"));
    assertThat(response.body()).doesNotContain("cookTimeSec", "ingredients", "nutrition");
  }

  @Test
  void noOptionsIsAnEmptyArray() throws Exception {
    when(menus.findById(10L)).thenReturn(Optional.of(menu(MenuStatus.ON_SALE)));
    var response = get("/api/v1/menus/10");
    assertThat(response.statusCode()).isEqualTo(200);
    assertThat(mapper.readTree(response.body()).path("data").path("options").isEmpty()).isTrue();
  }

  @Test
  void hiddenAndMissingHaveIdentical404Responses() throws Exception {
    when(menus.findById(10L)).thenReturn(Optional.of(menu(MenuStatus.HIDDEN)));
    var hidden = get("/api/v1/menus/10");
    when(menus.findById(10L)).thenReturn(Optional.empty());
    var missing = get("/api/v1/menus/10");
    assertError(hidden, 404, "MENU_NOT_FOUND");
    assertError(missing, 404, "MENU_NOT_FOUND");
    assertThat(hidden.body()).isEqualTo(missing.body());
    verifyNoInteractions(options);
  }

  @ParameterizedTest
  @ValueSource(strings = {"0", "-1", "abc", "1.5", "9223372036854775808", "-9223372036854775809"})
  void invalidMenuIdsAre400(String id) throws Exception {
    assertError(get("/api/v1/menus/" + id), 400, "INVALID_REQUEST");
    verifyNoInteractions(menus, categories, options);
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "categoryId=0",
        "categoryId=-1",
        "categoryId=all",
        "categoryId=1.5",
        "categoryId=9223372036854775808",
        "categoryId=",
        "categoryId=%20",
        "sort=",
        "sort=other",
        "sort=PRICEASC",
        "categoryId=1&categoryId=2",
        "sort=default&sort=priceAsc",
        "query=a&query=b"
      })
  void invalidQueryParametersAre400(String query) throws Exception {
    assertError(get("/api/v1/menus?" + query), 400, "INVALID_REQUEST");
    verifyNoInteractions(menus, categories, options);
  }

  @Test
  void largestDetailIdIsAValidMissingId() throws Exception {
    assertError(get("/api/v1/menus/9223372036854775807"), 404, "MENU_NOT_FOUND");
  }

  @ParameterizedTest
  @ValueSource(strings = {"categories", "menus", "detail", "options", "unexpected"})
  void failuresAre500AndDoNotExposeSql(String location) throws Exception {
    var failure = new DataAccessResourceFailureException("private SQL connection detail");
    String path = "/api/v1/menus";
    switch (location) {
      case "categories" -> when(categories.findAll()).thenThrow(failure);
      case "menus" -> when(menus.findByStatusIn(any())).thenThrow(failure);
      case "detail" -> {
        path += "/10";
        when(menus.findById(10L)).thenThrow(failure);
      }
      case "options" -> {
        path += "/10";
        when(menus.findById(10L)).thenReturn(Optional.of(menu(MenuStatus.PAUSED)));
        when(options.findByMenuIdOrderByIdAsc(10L)).thenThrow(failure);
      }
      default ->
          when(categories.findAll()).thenThrow(new IllegalStateException("private service detail"));
    }
    var response = get(path);
    assertError(response, 500, "INTERNAL_ERROR");
    assertThat(response.body()).doesNotContain("private", "SQL", "connection");
  }

  @Test
  void openApiDocumentsBothPublicAndBothInternalApisWithoutSchemaCollisions() throws Exception {
    var response = get("/v3/api-docs");
    assertThat(response.statusCode()).isEqualTo(200);
    var document = mapper.readTree(response.body());
    var paths = document.path("paths");
    assertThat(paths.has("/internal/v1/menus/validate-purchase")).isTrue();
    assertThat(paths.has("/internal/v1/menus/{menuId}/existence")).isTrue();
    var list = paths.path("/api/v1/menus").path("get");
    var detail = paths.path("/api/v1/menus/{menuId}").path("get");
    assertThat(list.path("parameters").size()).isEqualTo(3);
    assertThat(list.path("parameters").toString())
        .contains("categoryId", "query", "priceAsc", "priceDesc");
    assertThat(detail.path("responses").has("404")).isTrue();
    for (var operation : List.of(list, detail)) {
      for (String code : List.of("400", "500")) {
        var schema =
            operation
                .path("responses")
                .path(code)
                .path("content")
                .path("application/json")
                .path("schema");
        assertThat(schema.path("$ref").asString()).endsWith("/ApiResponse");
      }
    }
    var schemas = document.path("components").path("schemas");
    assertThat(schemas.path("CustomerMenuOption").path("properties").has("isDefault")).isTrue();
    assertThat(schemas.path("CustomerMenuOption").path("properties").has("active")).isTrue();
    assertThat(schemas.path("CustomerMenuSummary").path("properties").has("categoryId")).isTrue();
    assertThat(schemas.has("PurchaseValidationResultOption")).isTrue();
  }

  private void assertError(HttpResponse<String> response, int status, String code)
      throws Exception {
    assertThat(response.statusCode()).isEqualTo(status);
    JsonNode json = mapper.readTree(response.body());
    assertThat(json.path("success").asBoolean()).isFalse();
    assertThat(json.path("errorCode").asString()).isEqualTo(code);
    assertThat(json.path("message").asString()).isNotBlank();
    assertThat(json.has("data")).isFalse();
  }

  private HttpResponse<String> get(String path) throws Exception {
    try (var client = HttpClient.newHttpClient()) {
      return client.send(
          HttpRequest.newBuilder(URI.create("http://localhost:" + port + path))
              .timeout(Duration.ofSeconds(15))
              .GET()
              .build(),
          HttpResponse.BodyHandlers.ofString());
    }
  }
}
