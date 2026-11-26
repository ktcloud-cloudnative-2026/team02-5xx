package com.peakorder.menu;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import tools.jackson.databind.ObjectMapper;

/** Real PostgreSQL, Flyway, repositories, HikariCP, HTTP and Prometheus registry; no mocks. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@EnabledIfEnvironmentVariable(named = "MENU_DB_TEST_URL", matches = "jdbc:postgresql:.+")
class MenuObservabilityDatabaseTests {
  @LocalServerPort int port;

  @DynamicPropertySource
  static void databaseProperties(DynamicPropertyRegistry registry) {
    registry.add("spring.datasource.url", () -> System.getenv("MENU_DB_TEST_URL"));
    registry.add("spring.datasource.username", () -> System.getenv("MENU_DB_TEST_USERNAME"));
    registry.add("spring.datasource.password", () -> System.getenv("MENU_DB_TEST_PASSWORD"));
  }

  @Test
  void actualMenuQueriesProduceHttpAndPoolMetrics() throws Exception {
    assertThat(get("/api/v1/menus").statusCode()).isEqualTo(200);
    assertThat(get("/api/v1/menus/9223372036854775807").statusCode()).isEqualTo(404);
    var response = get("/actuator/prometheus");
    assertThat(response.statusCode()).isEqualTo(200);
    String metrics = response.body();
    MenuObservabilityHttpTests.assertHttpSample(
        metrics, "http_server_requests_seconds_count", "/api/v1/menus", "200");
    MenuObservabilityHttpTests.assertHttpSample(
        metrics, "http_server_requests_seconds_bucket", "/api/v1/menus", "200");
    for (String name :
        new String[] {
          "hikaricp_connections_active",
          "hikaricp_connections_idle",
          "hikaricp_connections_max",
          "hikaricp_connections_pending",
          "hikaricp_connections_acquire_seconds_count"
        }) {
      assertThat(metrics.lines().filter(line -> line.startsWith(name + "{")))
          .anySatisfy(
              line ->
                  assertThat(line).contains("application=\"menu-service\"", "pool=\"HikariPool-"));
    }
    assertThat(metrics).contains("jvm_memory_used_bytes", "jvm_gc_memory_allocated_bytes_total");
    assertThat(metrics).doesNotContain("jdbc:postgresql:");
    String password = System.getenv("MENU_DB_TEST_PASSWORD");
    if (password != null && !password.isEmpty()) {
      // A failed assertion must not print the credential itself into the test report.
      assertThat(metrics.contains(password))
          .as("DB password must be absent from metrics")
          .isFalse();
    }
  }

  @Test
  void healthyDatabaseDoesNotExposeHealthDetails() throws Exception {
    for (String endpoint : new String[] {"health", "health/liveness", "health/readiness"}) {
      var response = get("/actuator/" + endpoint);
      assertThat(response.statusCode()).as(endpoint).isEqualTo(200);
      var json = new ObjectMapper().readTree(response.body());
      assertThat(json.path("status").asString()).isEqualTo("UP");
      assertThat(json.has("components")).isFalse();
      assertThat(json.has("details")).isFalse();
    }
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
