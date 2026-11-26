package com.peakorder.menu;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.doReturn;

import com.peakorder.menu.entity.Category;
import com.peakorder.menu.repository.CategoryRepository;
import com.peakorder.menu.service.AdminMenuActivation;
import java.net.URI;
import java.net.http.*;
import java.util.stream.Stream;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * Real integrated HTTP/services/PostgreSQL. Real activation property; only the off-state is
 * simulated. Identity headers are local test inputs, not JWT validation.
 */
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = "menu.admin.enabled=true")
@EnabledIfEnvironmentVariable(named = "MENU_DB_TEST_URL", matches = "jdbc:postgresql:.+")
class AdminMenuIntegrationDatabaseTests {
  @LocalServerPort int port;
  @Autowired CategoryRepository categories;
  @Autowired JdbcTemplate jdbc;
  @MockitoSpyBean AdminMenuActivation activation;
  private long categoryId;
  private final ObjectMapper mapper = new ObjectMapper();
  private final HttpClient client = HttpClient.newHttpClient();

  @DynamicPropertySource
  static void database(DynamicPropertyRegistry r) {
    r.add("spring.datasource.url", () -> System.getenv("MENU_DB_TEST_URL"));
    r.add("spring.datasource.username", () -> System.getenv("MENU_DB_TEST_USERNAME"));
    r.add("spring.datasource.password", () -> System.getenv("MENU_DB_TEST_PASSWORD"));
  }

  @BeforeEach
  void fixture() {
    categoryId = categories.saveAndFlush(new Category("integration-245", 0)).getId();
  }

  @AfterEach
  void removeOwnFixtures() {
    jdbc.update(
        "delete from menu_options where menu_id in (select id from menus where category_id=?)",
        categoryId);
    jdbc.update("delete from menus where category_id=?", categoryId);
    jdbc.update("delete from categories where id=?", categoryId);
  }

  private HttpResponse<String> request(String method, String path, String body, String role)
      throws Exception {
    var builder =
        HttpRequest.newBuilder(URI.create("http://localhost:" + port + path))
            .header("Content-Type", "application/json");
    if (role != null) builder.header("X-User-Id", "42").header("X-User-Role", role);
    return client.send(
        builder
            .method(
                method,
                body == null
                    ? HttpRequest.BodyPublishers.noBody()
                    : HttpRequest.BodyPublishers.ofString(body))
            .build(),
        HttpResponse.BodyHandlers.ofString());
  }

  private JsonNode ok(String method, String path, String body, int status) throws Exception {
    var response = request(method, path, body, "STORE_ADMIN");
    assertThat(response.statusCode()).as(response.body()).isEqualTo(status);
    var envelope = mapper.readTree(response.body());
    assertThat(envelope.path("success").asBoolean()).isTrue();
    return envelope.path("data");
  }

  private long create() throws Exception {
    return ok(
            "POST",
            "/api/v1/admin/menus",
            """
        {"categoryId":%d,"name":"integrated","description":"keep","basePrice":100,
         "cookTimeSec":20,"status":"ON_SALE","options":[
          {"name":"first","extraPrice":10,"extraCookTimeSec":5},
          {"name":"untouched","extraPrice":20,"extraCookTimeSec":6}]}
        """
                .formatted(categoryId),
            201)
        .path("menuId")
        .asLong();
  }

  @Test
  void createQueryPartialEditAndStatusComposeWithCustomerAndInternalContracts() throws Exception {
    long id = create();
    String path = "/api/v1/admin/menus/" + id;
    var before = ok("GET", path, null, 200);
    long option = before.path("options").get(0).path("id").asLong();
    var list = ok("GET", "/api/v1/admin/menus?categoryId=" + categoryId, null, 200);
    assertThat(list.path("menus").size()).isEqualTo(1);
    ok(
        "PATCH",
        path,
        """
        {"name":"edited","description":null,"options":[
          {"optionId":%d,"extraPrice":30,"active":false},
          {"name":"added","extraPrice":40,"extraCookTimeSec":7}]}
        """
            .formatted(option),
        200);
    var after = ok("GET", path, null, 200);
    assertThat(after.path("name").asString()).isEqualTo("edited");
    assertThat(after.path("description").isNull()).isTrue();
    assertThat(after.path("basePrice").asInt()).isEqualTo(100);
    assertThat(after.path("status").asString()).isEqualTo("ON_SALE");
    assertThat(after.path("createdAt")).isEqualTo(before.path("createdAt"));
    assertThat(after.path("options").size()).isEqualTo(3);
    assertThat(after.path("options").get(0).path("active").asBoolean()).isFalse();
    assertThat(after.path("options").get(1)).isEqualTo(before.path("options").get(1));
    var customer = ok("GET", "/api/v1/menus/" + id, null, 200);
    assertThat(customer.path("name").asString()).isEqualTo("edited");
    long activeOption = after.path("options").get(2).path("id").asLong();
    var purchase =
        ok(
            "POST",
            "/internal/v1/menus/validate-purchase",
            """
        {"items":[{"menuId":%d,"quantity":2,"optionIds":[%d]}]}
        """
                .formatted(id, activeOption),
            200);
    assertThat(purchase.path("items").get(0).path("unitPrice").asInt()).isEqualTo(100);
    assertThat(purchase.path("items").get(0).path("options").get(0).path("extraPrice").asInt())
        .isEqualTo(40);
    ok("PATCH", path + "/status", "{\"status\":\"HIDDEN\"}", 200);
    assertThat(ok("GET", path, null, 200).path("options")).isEqualTo(after.path("options"));
    assertThat(request("GET", "/api/v1/menus/" + id, null, null).statusCode()).isEqualTo(404);
    assertThat(ok("GET", "/api/v1/menus?categoryId=" + categoryId, null, 200).path("menus").size())
        .isZero();
    assertThat(request("GET", "/internal/v1/menus/" + id + "/existence", null, null).statusCode())
        .isEqualTo(200);
  }

  static Stream<String> endpoints() {
    return Stream.of(
        "GET /api/v1/admin/menus",
        "GET /api/v1/admin/menus/1",
        "POST /api/v1/admin/menus",
        "PATCH /api/v1/admin/menus/1",
        "PATCH /api/v1/admin/menus/1/status");
  }

  @ParameterizedTest
  @MethodSource("endpoints")
  void allFiveOperationsShareActivationAnd401403PolicyBeforeParsingOrDatabase(String endpoint)
      throws Exception {
    var parts = endpoint.split(" ");
    var anonymous = request(parts[0], parts[1], "{", null);
    assertThat(anonymous.statusCode()).isEqualTo(401);
    assertThat(anonymous.body()).contains("UNAUTHORIZED");
    var customer = request(parts[0], parts[1], "{", "CUSTOMER");
    assertThat(customer.statusCode()).isEqualTo(403);
    assertThat(customer.body()).contains("FORBIDDEN");
    doReturn(false).when(activation).isEnabled();
    var forged = request(parts[0], parts[1], "{", "STORE_ADMIN");
    assertThat(forged.statusCode()).isEqualTo(403);
    assertThat(
            jdbc.queryForObject(
                "select count(*) from menus where category_id=?", Long.class, categoryId))
        .isZero();
  }
}
