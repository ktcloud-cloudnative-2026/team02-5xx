package com.peakorder.menu;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.peakorder.menu.entity.Category;
import com.peakorder.menu.entity.Menu;
import com.peakorder.menu.entity.MenuOption;
import com.peakorder.menu.entity.MenuStatus;
import com.peakorder.menu.exception.AdminMenuAccessException;
import com.peakorder.menu.repository.AdminMenuQueryRepository;
import com.peakorder.menu.repository.CategoryRepository;
import com.peakorder.menu.repository.MenuOptionRepository;
import com.peakorder.menu.repository.MenuRepository;
import com.peakorder.menu.repository.MenuStatusRepository;
import com.peakorder.menu.service.AdminMenuAuthorization;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.util.ReflectionTestUtils;
import tools.jackson.databind.ObjectMapper;

/** Authorization results are mocked here; these tests do not verify real authentication. */
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties =
        "spring.autoconfigure.exclude=org.springframework.boot.jdbc.autoconfigure.DataSourceAutoConfiguration")
class AdminMenuHttpTests {
  @MockitoBean MenuStatusRepository statusRepository;

  @LocalServerPort private int port;
  @MockitoBean private AdminMenuAuthorization authorization;
  @MockitoBean private AdminMenuQueryRepository adminMenus;
  @MockitoBean private CategoryRepository categories;
  @MockitoBean private MenuRepository menus;
  @MockitoBean private MenuOptionRepository options;
  private final ObjectMapper mapper = new ObjectMapper();

  @BeforeEach
  void simulateVerifiedStoreAdminAtTheAuthorizationBoundary() {
    // Test-only authorization result. Production has no allow implementation or request switch.
    doNothing().when(authorization).requireStoreAdmin();
  }

  private Menu menu(long id, MenuStatus status) {
    var category = new Category("Burgers", 0);
    ReflectionTestUtils.setField(category, "id", 2L);
    var menu = new Menu(category, "Classic Burger", null, null, 6500, 90, status);
    ReflectionTestUtils.setField(menu, "id", id);
    ReflectionTestUtils.setField(menu, "createdAt", Instant.parse("2026-11-01T00:00:00Z"));
    ReflectionTestUtils.setField(menu, "updatedAt", Instant.parse("2026-11-02T00:00:00Z"));
    return menu;
  }

  @Test
  void simulatedAdminCanListAllThreeStates() throws Exception {
    var onSale = menu(1, MenuStatus.ON_SALE);
    when(categories.findAll()).thenReturn(List.of(onSale.getCategory()));
    when(adminMenus.findAllWithCategory())
        .thenReturn(List.of(menu(3, MenuStatus.HIDDEN), menu(2, MenuStatus.PAUSED), onSale));
    var response = get("/api/v1/admin/menus");
    assertThat(response.statusCode()).isEqualTo(200);
    var json = mapper.readTree(response.body());
    assertThat(json.path("success").asBoolean()).isTrue();
    assertThat(json.path("message").asString()).isEqualTo("OK");
    assertThat(json.has("errorCode")).isFalse();
    var data = json.path("data");
    assertThat(data.path("categories").get(0).path("name").asString()).isEqualTo("Burgers");
    assertThat(data.path("menus").size()).isEqualTo(3);
    assertThat(data.path("menus").get(0).path("status").asString()).isEqualTo("ON_SALE");
    assertThat(data.path("menus").get(1).path("status").asString()).isEqualTo("PAUSED");
    assertThat(data.path("menus").get(2).path("status").asString()).isEqualTo("HIDDEN");
    assertThat(data.path("menus").get(0).path("cookTimeSec").asInt()).isEqualTo(90);
    verify(authorization).requireStoreAdmin();
    verifyNoInteractions(menus, options);
  }

  @ParameterizedTest
  @EnumSource(MenuStatus.class)
  void listAppliesCategoryTrimmedSearchAndStatus(MenuStatus status) throws Exception {
    when(adminMenus.findAllWithCategory())
        .thenReturn(
            List.of(
                menu(1, MenuStatus.ON_SALE),
                menu(2, MenuStatus.PAUSED),
                menu(3, MenuStatus.HIDDEN)));
    var response =
        get(
            "/api/v1/admin/menus?categoryId=2&query=%20bUrGeR%20&status="
                + status
                + "&sort=priceDesc");
    assertThat(response.statusCode()).isEqualTo(200);
    var items = mapper.readTree(response.body()).path("data").path("menus");
    assertThat(items.size()).isEqualTo(1);
    assertThat(items.get(0).path("status").asString()).isEqualTo(status.name());
  }

  @ParameterizedTest
  @ValueSource(strings = {"", "?categoryId=9223372036854775807", "?query=%20%20", "?query=absent"})
  void emptyResultsAreSuccessful(String query) throws Exception {
    var response = get("/api/v1/admin/menus" + query);
    assertThat(response.statusCode()).isEqualTo(200);
    assertThat(mapper.readTree(response.body()).path("data").path("menus").isEmpty()).isTrue();
  }

  @ParameterizedTest
  @EnumSource(MenuStatus.class)
  void detailIncludesHiddenNullableFieldsTimestampsAndInactiveOptions(MenuStatus status)
      throws Exception {
    var menu = menu(10, status);
    var option = new MenuOption(menu, "Inactive", 2500, 30, true, false);
    ReflectionTestUtils.setField(option, "id", 31L);
    when(adminMenus.findWithCategoryById(10L)).thenReturn(Optional.of(menu));
    when(adminMenus.findOptionsByMenuId(10L)).thenReturn(List.of(option));
    var response = get("/api/v1/admin/menus/10");
    assertThat(response.statusCode()).isEqualTo(200);
    var data = mapper.readTree(response.body()).path("data");
    assertThat(data.size()).isEqualTo(11);
    assertThat(data.path("status").asString()).isEqualTo(status.name());
    assertThat(data.path("description").isNull()).isTrue();
    assertThat(data.path("imageUrl").isNull()).isTrue();
    assertThat(data.path("createdAt").asString()).isEqualTo("2026-11-01T00:00:00Z");
    assertThat(data.path("updatedAt").asString()).isEqualTo("2026-11-02T00:00:00Z");
    assertThat(data.path("options").get(0))
        .isEqualTo(
            mapper.readTree(
                "{\"id\":31,\"name\":\"Inactive\",\"extraPrice\":2500,\"extraCookTimeSec\":30,\"isDefault\":true,\"active\":false}"));
  }

  @Test
  void existingMenuWithoutOptionsHasEmptyArray() throws Exception {
    when(adminMenus.findWithCategoryById(1L)).thenReturn(Optional.of(menu(1, MenuStatus.HIDDEN)));
    var response = get("/api/v1/admin/menus/1");
    assertThat(response.statusCode()).isEqualTo(200);
    assertThat(mapper.readTree(response.body()).path("data").path("options").isEmpty()).isTrue();
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "categoryId=0",
        "categoryId=-1",
        "categoryId=abc",
        "categoryId=",
        "categoryId=%20",
        "categoryId=1.5",
        "categoryId=9223372036854775808",
        "sort=",
        "sort=invalid",
        "sort=PRICEASC",
        "status=",
        "status=hidden",
        "status=SOLD_OUT",
        "status=ON_SALE,PAUSED",
        "categoryId=1&categoryId=2",
        "query=a&query=b",
        "status=HIDDEN&status=ON_SALE",
        "sort=default&sort=priceAsc"
      })
  void invalidParametersReturn400AfterSimulatedAuthorization(String query) throws Exception {
    assertError(get("/api/v1/admin/menus?" + query), 400, "INVALID_REQUEST");
    verify(authorization).requireStoreAdmin();
    verifyNoInteractions(adminMenus, categories);
  }

  @ParameterizedTest
  @ValueSource(strings = {"0", "-1", "abc", "1.5", "9223372036854775808", "-9223372036854775809"})
  void invalidDetailIdsReturn400(String id) throws Exception {
    assertError(get("/api/v1/admin/menus/" + id), 400, "INVALID_REQUEST");
    verifyNoInteractions(adminMenus, categories);
  }

  @Test
  void largestValidMissingIdReturns404() throws Exception {
    assertError(get("/api/v1/admin/menus/9223372036854775807"), 404, "MENU_NOT_FOUND");
  }

  @ParameterizedTest
  @ValueSource(booleans = {true, false})
  void simulatedMissingIdentityAndInsufficientRoleUseCommonErrors(boolean unauthenticated)
      throws Exception {
    doThrow(
            unauthenticated
                ? AdminMenuAccessException.unauthenticated()
                : AdminMenuAccessException.forbidden())
        .when(authorization)
        .requireStoreAdmin();
    // Invalid input must not reach query validation or the database before access is denied.
    assertError(
        get("/api/v1/admin/menus?categoryId=invalid"),
        unauthenticated ? 401 : 403,
        unauthenticated ? "UNAUTHORIZED" : "FORBIDDEN");
    assertError(
        get("/api/v1/admin/menus/invalid"),
        unauthenticated ? 401 : 403,
        unauthenticated ? "UNAUTHORIZED" : "FORBIDDEN");
    verifyNoInteractions(adminMenus, categories);
  }

  @ParameterizedTest
  @ValueSource(strings = {"categories", "list", "detail", "options", "authorization"})
  void unexpectedFailuresReturn500WithoutPrivateDetails(String location) throws Exception {
    var failure = new DataAccessResourceFailureException("private SQL connection detail");
    String path = "/api/v1/admin/menus";
    switch (location) {
      case "categories" -> when(categories.findAll()).thenThrow(failure);
      case "list" -> when(adminMenus.findAllWithCategory()).thenThrow(failure);
      case "detail" -> {
        path += "/1";
        when(adminMenus.findWithCategoryById(1L)).thenThrow(failure);
      }
      case "options" -> {
        path += "/1";
        when(adminMenus.findWithCategoryById(1L))
            .thenReturn(Optional.of(menu(1, MenuStatus.HIDDEN)));
        when(adminMenus.findOptionsByMenuId(1L)).thenThrow(failure);
      }
      default ->
          doThrow(new IllegalStateException("private authorization detail"))
              .when(authorization)
              .requireStoreAdmin();
    }
    var response = get(path);
    assertError(response, 500, "INTERNAL_ERROR");
    assertThat(response.body()).doesNotContain("private", "SQL", "connection");
  }

  @Test
  void openApiDescribesDeploymentGateParametersSuccessAndErrorSchemas() throws Exception {
    var response = get("/v3/api-docs");
    assertThat(response.statusCode()).isEqualTo(200);
    var document = mapper.readTree(response.body());
    var list = document.path("paths").path("/api/v1/admin/menus").path("get");
    var detail = document.path("paths").path("/api/v1/admin/menus/{menuId}").path("get");
    assertThat(list.path("parameters").size()).isEqualTo(4);
    assertThat(list.path("parameters").toString())
        .contains("categoryId", "query", "status", "sort", "HIDDEN");
    assertThat(list.path("description").asString())
        .contains("Disabled by default", "MENU_ADMIN_ENABLED=false", "STORE_ADMIN");
    for (var operation : List.of(list, detail)) {
      assertThat(operation.path("responses").has("200")).isTrue();
      for (String code : List.of("400", "401", "403", "500")) {
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
    assertThat(detail.path("responses").has("404")).isTrue();
    var schemas = document.path("components").path("schemas");
    assertThat(schemas.path("AdminMenuOption").path("properties").has("isDefault")).isTrue();
    assertThat(schemas.path("AdminMenuOption").path("properties").has("extraCookTimeSec")).isTrue();
    assertThat(schemas.path("AdminMenuDetail").path("properties").has("createdAt")).isTrue();
    assertThat(schemas.has("PurchaseValidationResultOption")).isTrue();
    assertThat(document.path("components").has("securitySchemes")).isFalse();
  }

  private void assertError(HttpResponse<String> response, int status, String code)
      throws Exception {
    assertThat(response.statusCode()).isEqualTo(status);
    var json = mapper.readTree(response.body());
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
