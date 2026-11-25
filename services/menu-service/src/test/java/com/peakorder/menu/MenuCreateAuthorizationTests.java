package com.peakorder.menu;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.peakorder.menu.repository.*;
import com.peakorder.menu.service.AdminMenuCreateService;
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
class MenuCreateAuthorizationTests {
  @MockitoBean MenuStatusRepository statusRepository;

  @MockitoBean AdminMenuQueryRepository adminQueryRepository;

  @LocalServerPort int port;
  @MockitoBean AdminMenuCreateService service;
  @MockitoBean MenuRepository menus;
  @MockitoBean MenuOptionRepository options;
  @MockitoBean CategoryRepository categories;

  @Test
  void deniesAnonymousRequest() throws Exception {
    var request =
        HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/v1/admin/menus"))
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString("{}"))
            .build();
    var response = HttpClient.newHttpClient().send(request, HttpResponse.BodyHandlers.ofString());
    assertThat(response.statusCode()).isEqualTo(403);
    verifyNoInteractions(service, menus, options);
  }

  @ParameterizedTest
  @ValueSource(strings = {"{}", "{", "null", ""})
  void deniesBeforeReadingBodyEvenWithForgedIdentity(String body) throws Exception {
    var request =
        HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/v1/admin/menus"))
            .header("Content-Type", "application/json")
            .header("X-User-Role", "STORE_ADMIN")
            .header("X-User-Id", "1")
            .header("Authorization", "Bearer unverified.payload.signature")
            .POST(HttpRequest.BodyPublishers.ofString(body))
            .build();
    var response = HttpClient.newHttpClient().send(request, HttpResponse.BodyHandlers.ofString());
    assertThat(response.statusCode()).isEqualTo(403);
    assertThat(response.body()).contains("FORBIDDEN").doesNotContain("menuId");
    verifyNoInteractions(service, menus, options);
  }
}
