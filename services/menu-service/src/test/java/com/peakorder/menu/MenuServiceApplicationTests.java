package com.peakorder.menu;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import tools.jackson.databind.ObjectMapper;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class MenuServiceApplicationTests {

  @LocalServerPort private int port;

  @Test
  void servesOpenApiDocumentWithoutBusinessEndpoints() throws Exception {
    var response = get("/v3/api-docs");

    assertThat(response.statusCode()).isEqualTo(200);
    var document = new ObjectMapper().readTree(response.body());
    assertThat(document.path("openapi").asString()).startsWith("3.");
    assertThat(document.path("paths").isObject()).isTrue();
    assertThat(document.path("paths").isEmpty()).isTrue();
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
