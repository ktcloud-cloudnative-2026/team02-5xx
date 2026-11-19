package com.peakorder.menu;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

import com.peakorder.menu.entity.*;
import com.peakorder.menu.repository.*;
import com.peakorder.menu.service.MenuCreateAuthorization;
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
class AdminMenuCreateHttpTests {
  @LocalServerPort int port;
  @MockitoBean MenuRepository menus;
  @MockitoBean MenuOptionRepository options;
  @MockitoBean CategoryRepository categories;
  @MockitoBean MenuCreateAuthorization authorization;
  private final ObjectMapper mapper = new ObjectMapper();
  private static final String VALID =
      "{\"categoryId\":1,\"name\":\"Burger\",\"basePrice\":0,\"cookTimeSec\":0,\"status\":\"HIDDEN\"}";

  @BeforeEach
  void setUp() {
    when(categories.findById(1L)).thenReturn(Optional.of(new Category("Food", 0)));
    when(menus.saveAndFlush(any()))
        .thenAnswer(
            call -> {
              Menu m = call.getArgument(0);
              ReflectionTestUtils.setField(m, "id", 9L);
              return m;
            });
  }

  private HttpResponse<String> post(String json) throws Exception {
    return HttpClient.newHttpClient()
        .send(
            HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/v1/admin/menus"))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(json))
                .build(),
            HttpResponse.BodyHandlers.ofString());
  }

  @Test
  void simulatedAuthorizationAllowsCreationAndOptions() throws Exception {
    var response =
        post(
            VALID.replace(
                "}",
                ",\"options\":[{\"name\":\"Set\",\"extraPrice\":10,\"extraCookTimeSec\":5,\"isDefault\":true,\"active\":false}]}"));
    assertThat(response.statusCode()).isEqualTo(201);
    var data = mapper.readTree(response.body());
    assertThat(data.path("success").asBoolean()).isTrue();
    assertThat(data.path("data").path("menuId").asLong()).isEqualTo(9);
    assertThat(data.path("message").asString()).isEqualTo("OK");
    verify(options).saveAllAndFlush(any());
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "",
        "{",
        "null",
        "[]",
        "{}",
        "{\"categoryId\":1}",
        "{\"categoryId\":1,\"categoryId\":2}",
        "{} {}"
      })
  void rejectsMalformedMissingDuplicateAndTrailingInput(String body) throws Exception {
    error(post(body), 400, "INVALID_REQUEST");
    verifyNoInteractions(categories, menus, options);
  }

  @ParameterizedTest
  @ValueSource(strings = {"\"-1\"", "-1", "1.5", "2147483648", "null", "true"})
  void rejectsInvalidPricesWithoutPersistence(String value) throws Exception {
    error(post(VALID.replace("\"basePrice\":0", "\"basePrice\":" + value)), 400, "INVALID_REQUEST");
    verifyNoInteractions(categories, menus, options);
  }

  @ParameterizedTest
  @ValueSource(strings = {"on_sale", "UNKNOWN", ""})
  void rejectsUnknownStates(String status) throws Exception {
    error(post(VALID.replace("HIDDEN", status)), 400, "INVALID_REQUEST");
  }

  @Test
  void missingCategoryReturns404WithoutWrites() throws Exception {
    error(post(VALID.replace("\"categoryId\":1", "\"categoryId\":2")), 404, "CATEGORY_NOT_FOUND");
    verifyNoInteractions(menus, options);
  }

  @Test
  void rejectsDuplicateFieldsAndTrailingDocumentsInOtherwiseValidRequests() throws Exception {
    error(
        post(VALID.replace("\"categoryId\":1", "\"categoryId\":1,\"categoryId\":1")),
        400,
        "INVALID_REQUEST");
    error(post(VALID + " {}"), 400, "INVALID_REQUEST");
    verifyNoInteractions(categories, menus, options);
  }

  @Test
  void internalFailureDoesNotExposeDatabaseDetails() throws Exception {
    doThrow(new DataAccessResourceFailureException("SQL password=private"))
        .when(menus)
        .saveAndFlush(any());
    var response = post(VALID);
    error(response, 500, "INTERNAL_ERROR");
    assertThat(response.body()).doesNotContain("SQL", "password", "private");
  }

  @Test
  void openApiContainsRequestAndCreatedEnvelopeAndErrors() throws Exception {
    var response =
        HttpClient.newHttpClient()
            .send(
                HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/v3/api-docs"))
                    .GET()
                    .build(),
                HttpResponse.BodyHandlers.ofString());
    assertThat(response.statusCode()).isEqualTo(200);
    var doc = mapper.readTree(response.body());
    var operation = doc.path("paths").path("/api/v1/admin/menus").path("post");
    assertThat(operation.path("summary").asString()).contains("disabled");
    assertThat(operation.path("requestBody").path("required").asBoolean()).isTrue();
    for (String code : new String[] {"201", "400", "403", "404", "500"})
      assertThat(operation.path("responses").has(code)).isTrue();
    assertThat(doc.path("components").path("schemas").toString())
        .contains("menuId", "isDefault", "active", "extraCookTimeSec", "categoryId");
  }

  private void error(HttpResponse<String> response, int status, String code) throws Exception {
    assertThat(response.statusCode()).isEqualTo(status);
    var node = mapper.readTree(response.body());
    assertThat(node.path("success").asBoolean()).isFalse();
    assertThat(node.path("errorCode").asString()).isEqualTo(code);
    assertThat(node.has("data")).isFalse();
  }
}
