package com.peakorder.menu;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.peakorder.menu.repository.*;
import com.peakorder.menu.service.MenuUpdateService;
import java.net.URI;
import java.net.http.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties =
        "spring.autoconfigure.exclude=org.springframework.boot.jdbc.autoconfigure.DataSourceAutoConfiguration")
class MenuUpdateAuthorizationTests {
  @LocalServerPort int port;
  @MockitoBean MenuUpdateService service;
  @MockitoBean MenuRepository menus;
  @MockitoBean MenuOptionRepository options;

  @ParameterizedTest
  @ValueSource(strings = {"{}", "{", "", "{\"name\":\"new\"}"})
  void actualBoundaryDeniesForgedHeadersAndJwtBeforeIdAndBody(String body) throws Exception {
    var request =
        HttpRequest.newBuilder(
                URI.create("http://localhost:" + port + "/api/v1/admin/menus/invalid"))
            .header("Content-Type", "application/json")
            .header("X-User-Id", "1")
            .header("X-User-Role", "STORE_ADMIN")
            .header("Authorization", "Bearer unverified.payload.signature")
            .method("PATCH", HttpRequest.BodyPublishers.ofString(body))
            .build();
    var response = HttpClient.newHttpClient().send(request, HttpResponse.BodyHandlers.ofString());
    assertThat(response.statusCode()).isEqualTo(403);
    assertThat(response.body()).contains("FORBIDDEN");
    verifyNoInteractions(service, menus, options);
  }

  @Test
  void anonymousRequestIsActuallyDenied() throws Exception {
    var request =
        HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/v1/admin/menus/1"))
            .header("Content-Type", "application/json")
            .method("PATCH", HttpRequest.BodyPublishers.ofString("{\"name\":\"x\"}"))
            .build();
    assertThat(
            HttpClient.newHttpClient()
                .send(request, HttpResponse.BodyHandlers.ofString())
                .statusCode())
        .isEqualTo(403);
    verifyNoInteractions(service, menus, options);
  }
}
