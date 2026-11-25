package com.peakorder.auth;

import static org.assertj.core.api.Assertions.assertThat;

import com.peakorder.auth.service.RegistrationService;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.ApplicationContext;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import tools.jackson.databind.ObjectMapper;

@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties =
        "spring.autoconfigure.exclude=org.springframework.boot.jdbc.autoconfigure.DataSourceAutoConfiguration")
class AuthServiceApplicationTests {

  @MockitoBean private RegistrationService registration;

  @Autowired private ApplicationContext applicationContext;

  @LocalServerPort private int port;

  @Test
  void startsApplicationContext() {
    assertThat(applicationContext.getBean(AuthServiceApplication.class)).isNotNull();
  }

  @Test
  void exposesOpenApiDocument() throws Exception {
    var response = get("/v3/api-docs");

    assertThat(response.statusCode()).isEqualTo(200);
    var document = new ObjectMapper().readTree(response.body());
    assertThat(document.path("openapi").asString()).startsWith("3.");
    assertThat(document.path("paths").isObject()).isTrue();
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
  void unconfiguredSessionFeatureRemainsUnavailableWithoutBreakingStartup() throws Exception {
    var response = get("/api/v1/auth/jwks");
    assertThat(response.statusCode()).isEqualTo(503);
    assertThat(new ObjectMapper().readTree(response.body()).path("errorCode").asString())
        .isEqualTo("AUTHENTICATION_UNAVAILABLE");
  }

  @Test
  void unconfiguredAccountRoutesRemainUnavailable() throws Exception {
    for (String path : new String[] {"/me", "/me/password"}) {
      String body =
          path.equals("/me")
              ? "{\"nickname\":\"member\"}"
              : "{\"currentPassword\":\"current local password\",\"newPassword\":\"changed local password\"}";
      try (var client = HttpClient.newHttpClient()) {
        var response =
            client.send(
                HttpRequest.newBuilder(
                        URI.create("http://127.0.0.1:" + port + "/api/v1/auth" + path))
                    .header("Content-Type", "application/json")
                    .header("Authorization", "Bearer synthetic-access")
                    .method("PATCH", HttpRequest.BodyPublishers.ofString(body))
                    .build(),
                HttpResponse.BodyHandlers.ofString());
        assertThat(response.statusCode()).isEqualTo(503);
        assertThat(new ObjectMapper().readTree(response.body()).path("errorCode").asString())
            .isEqualTo("AUTHENTICATION_UNAVAILABLE");
        assertThat(response.headers().firstValue("set-cookie")).isEmpty();
      }
    }
  }

  @Test
  void exposesKubernetesHealthProbes() throws Exception {
    for (String path : new String[] {"/actuator/health/liveness", "/actuator/health/readiness"}) {
      var response = get(path);
      assertThat(response.statusCode()).as(path).isEqualTo(200);
      assertThat(new ObjectMapper().readTree(response.body()).path("status").asString())
          .as(path)
          .isEqualTo("UP");
    }
  }

  @Test
  void exposesPrometheusMetricsWithApplicationTagAndHistogram() throws Exception {
    get("/v3/api-docs");

    var response = get("/actuator/prometheus");

    assertThat(response.statusCode()).isEqualTo(200);
    assertThat(response.body())
        .contains("http_server_requests_seconds_count")
        .contains("http_server_requests_seconds_bucket")
        .contains("application=\"auth-service\"");
  }

  @Test
  void keepsOtherActuatorEndpointsClosed() throws Exception {
    for (String path : new String[] {"/actuator/env", "/actuator/beans", "/actuator/heapdump"}) {
      assertThat(get(path).statusCode()).as(path).isEqualTo(404);
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
