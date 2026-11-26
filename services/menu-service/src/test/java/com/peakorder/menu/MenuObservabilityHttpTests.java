package com.peakorder.menu;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

import com.peakorder.menu.repository.AdminMenuQueryRepository;
import com.peakorder.menu.repository.CategoryRepository;
import com.peakorder.menu.repository.MenuOptionRepository;
import com.peakorder.menu.repository.MenuRepository;
import com.peakorder.menu.repository.MenuStatusRepository;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import tools.jackson.databind.ObjectMapper;

/**
 * Real HTTP/registry with mocked repositories; PostgreSQL coverage lives in the separate DB test.
 */
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties =
        "spring.autoconfigure.exclude=org.springframework.boot.jdbc.autoconfigure.DataSourceAutoConfiguration")
@ExtendWith(OutputCaptureExtension.class)
class MenuObservabilityHttpTests {
  @LocalServerPort int port;
  @MockitoBean MenuRepository menus;
  @MockitoBean CategoryRepository categories;
  @MockitoBean MenuOptionRepository options;
  @MockitoBean MenuStatusRepository statusRepository;
  @MockitoBean AdminMenuQueryRepository adminQueryRepository;

  @ParameterizedTest
  @ValueSource(strings = {"health", "health/liveness", "health/readiness"})
  void healthExposesStatusWithoutSensitiveDetails(String endpoint) throws Exception {
    var response = get("/actuator/" + endpoint);
    assertThat(response.statusCode()).isEqualTo(200);
    var json = new ObjectMapper().readTree(response.body());
    assertThat(json.path("status").asString()).isEqualTo("UP");
    assertThat(json.has("components")).isFalse();
    assertThat(json.has("details")).isFalse();
    assertThat(response.body()).doesNotContain("jdbc:", "password", "username");
  }

  @Test
  void infoIsAvailableWithoutEnvironmentDetails() throws Exception {
    var response = get("/actuator/info");
    assertThat(response.statusCode()).isEqualTo(200);
    assertThat(new ObjectMapper().readTree(response.body()).isEmpty()).isTrue();
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "env", "env/MENU_DB_PASSWORD", "beans", "configprops", "heapdump", "loggers",
        "loggers/ROOT", "metrics", "mappings", "threaddump", "shutdown", "flyway"
      })
  void unexposedEndpointsHaveNoHttpHandler(String endpoint) throws Exception {
    assertThat(get("/actuator/" + endpoint).statusCode()).as(endpoint).isEqualTo(404);
  }

  @Test
  void metricsUseRouteTemplatesAndExcludeRequestSecrets(CapturedOutput output) throws Exception {
    // Synthetic canaries only; no actual credentials, tokens or personal data are used.
    String canary = "observability-private-canary-361";
    assertThat(get("/api/v1/menus?query=" + canary).statusCode()).isEqualTo(200);
    assertThat(get("/api/v1/menus/123456789").statusCode()).isEqualTo(404);
    assertThat(get("/api/v1/menus/987654321").statusCode()).isEqualTo(404);
    when(menus.findByStatusIn(any())).thenThrow(new IllegalStateException(canary));
    assertThat(get("/api/v1/menus").statusCode()).isEqualTo(500);
    var malformed =
        HttpRequest.newBuilder(
                URI.create("http://localhost:" + port + "/internal/v1/menus/validate-purchase"))
            .timeout(Duration.ofSeconds(15))
            .header("Content-Type", "application/json")
            .header("Authorization", "Bearer " + canary)
            .header("X-User-Id", canary)
            .POST(HttpRequest.BodyPublishers.ofString("{\"private\":\"" + canary + "\""))
            .build();
    try (var client = HttpClient.newHttpClient()) {
      assertThat(client.send(malformed, HttpResponse.BodyHandlers.ofString()).statusCode())
          .isEqualTo(400);
    }
    var response = get("/actuator/prometheus");
    assertThat(response.statusCode()).isEqualTo(200);
    assertThat(response.headers().firstValue("Content-Type").orElseThrow()).contains("text/plain");
    String metrics = response.body();
    assertThat(metrics).contains("jvm_memory_used_bytes", "jvm_gc_memory_allocated_bytes_total");
    assertHttpSample(metrics, "http_server_requests_seconds_count", "/api/v1/menus", "200");
    assertHttpSample(metrics, "http_server_requests_seconds_bucket", "/api/v1/menus", "200");
    assertHttpSample(metrics, "http_server_requests_seconds_count", "/api/v1/menus", "500");
    assertHttpSample(
        metrics, "http_server_requests_seconds_count", "/api/v1/menus/{menuId}", "404");
    assertThat(metrics).doesNotContain(canary, "123456789", "987654321", "Bearer ", "jdbc:");
    assertThat(output.getAll()).doesNotContain(canary);
  }

  static void assertHttpSample(String metrics, String metric, String uri, String status) {
    assertThat(metrics.lines().filter(line -> line.startsWith(metric + "{")))
        .anySatisfy(
            line ->
                assertThat(line)
                    .contains(
                        "application=\"menu-service\"",
                        "uri=\"" + uri + "\"",
                        "status=\"" + status + "\""));
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
