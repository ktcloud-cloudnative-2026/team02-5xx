package com.peakorder.auth;

import static com.peakorder.auth.AuthSessionTestSupport.*;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.peakorder.auth.config.SessionCookiePolicy;
import com.peakorder.auth.dto.CurrentUserResponse;
import com.peakorder.auth.dto.SessionResponse;
import com.peakorder.auth.dto.SessionResponse.SessionUser;
import com.peakorder.auth.entity.UserRole;
import com.peakorder.auth.exception.BusinessException;
import com.peakorder.auth.exception.ErrorCode;
import com.peakorder.auth.service.RegistrationService;
import com.peakorder.auth.service.SessionService;
import com.peakorder.auth.service.SessionService.SessionResult;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Clock;
import java.time.Duration;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Bean;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import tools.jackson.databind.ObjectMapper;

@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = {
      "spring.autoconfigure.exclude=org.springframework.boot.jdbc.autoconfigure.DataSourceAutoConfiguration",
      "auth.session.enabled=false"
    })
class SessionHttpTests {
  @MockitoBean private RegistrationService registration;
  @MockitoBean private SessionService sessions;
  @LocalServerPort private int port;
  private final ObjectMapper json = new ObjectMapper();

  @TestConfiguration
  static class CookieConfig {
    @Bean
    SessionCookiePolicy sessionCookiePolicy() {
      return new SessionCookiePolicy(properties(), Clock.systemUTC());
    }
  }

  @BeforeEach
  void prepare() {
    var response =
        new SessionResponse(
            "synthetic-access",
            "Bearer",
            900,
            new SessionUser(42L, "member@example.test", UserRole.CUSTOMER));
    var result =
        new SessionResult(response, RAW, false, java.time.Instant.now().plusSeconds(86400));
    when(sessions.login(any())).thenReturn(result);
    when(sessions.refresh(any())).thenReturn(result);
    when(sessions.currentUser("synthetic-access"))
        .thenReturn(new CurrentUserResponse(42L, "member@example.test", null, UserRole.CUSTOMER));
    when(sessions.publicKeys()).thenReturn(Map.of("keys", java.util.List.of(Map.of("kty", "RSA"))));
  }

  @Test
  void loginAndRefreshDeliverAccessInJsonAndRefreshOnlyInHttpOnlyCookie() throws Exception {
    for (String path : java.util.List.of("/login", "/refresh")) {
      var response =
          post(
              path,
              path.equals("/login")
                  ? "{\"email\":\"member@example.test\",\"password\":\"valid password\"}"
                  : "",
              "Origin",
              ORIGIN,
              "Cookie",
              "peakorderRefreshToken=" + RAW);
      assertThat(response.statusCode()).isEqualTo(200);
      var data = json.readTree(response.body()).path("data");
      assertThat(data.path("expiresIn").asLong()).isEqualTo(900);
      assertThat(data.path("user").path("id").asLong()).isEqualTo(42);
      assertThat(response.body()).doesNotContain(RAW, "refreshToken", "password");
      assertThat(response.headers().firstValue("set-cookie").orElseThrow())
          .contains("HttpOnly", "Secure", "SameSite=Strict", "Path=/api/v1/auth")
          .doesNotContain("Domain=", "Max-Age=");
      assertThat(response.headers().firstValue("cache-control")).contains("no-store");
    }
  }

  @ParameterizedTest
  @ValueSource(strings = {"\"true\"", "1", "null", "[]", "{}"})
  void rejectsNonBooleanRememberMe(String value) throws Exception {
    var response =
        post(
            "/login",
            "{\"email\":\"member@example.test\",\"password\":\"valid\",\"rememberMe\":"
                + value
                + "}",
            "Origin",
            ORIGIN);
    error(response, 400, "INVALID_REQUEST");
    verify(sessions, never()).login(any());
  }

  @Test
  void loginAcceptsActualBooleansAndRejectsPrivilegeFields() throws Exception {
    for (String value : java.util.List.of("true", "false")) {
      assertThat(
              post(
                      "/login",
                      "{\"email\":\"member@example.test\",\"password\":\"valid\",\"rememberMe\":"
                          + value
                          + "}",
                      "Origin",
                      ORIGIN)
                  .statusCode())
          .isEqualTo(200);
    }
    error(
        post(
            "/login",
            "{\"email\":\"member@example.test\",\"password\":\"valid\",\"role\":\"STORE_ADMIN\"}",
            "Origin",
            ORIGIN),
        400,
        "INVALID_REQUEST");
  }

  @ParameterizedTest
  @ValueSource(strings = {"/login", "/refresh", "/logout"})
  void rejectsMissingOrUntrustedSourceBeforeMutatingSession(String path) throws Exception {
    String body =
        path.equals("/login") ? "{\"email\":\"member@example.test\",\"password\":\"valid\"}" : "";
    error(post(path, body), 403, "FORBIDDEN");
    error(post(path, body, "Origin", "https://evil.example.test"), 403, "FORBIDDEN");
    verify(sessions, never()).login(any());
    verify(sessions, never()).refresh(any());
    verify(sessions, never()).logout(any());
  }

  @Test
  void acceptsRefererFallbackButRejectsDuplicateCookiesAndBodies() throws Exception {
    assertThat(
            post(
                    "/refresh",
                    "",
                    "Referer",
                    ORIGIN + "/menu",
                    "Cookie",
                    "peakorderRefreshToken=" + RAW)
                .statusCode())
        .isEqualTo(200);
    error(
        post(
            "/refresh",
            "",
            "Origin",
            ORIGIN,
            "Cookie",
            "peakorderRefreshToken=" + RAW + "; peakorderRefreshToken=" + RAW),
        400,
        "INVALID_REQUEST");
    error(post("/refresh", "{}", "Origin", ORIGIN), 400, "INVALID_REQUEST");
    error(post("/logout", "{}", "Origin", ORIGIN), 400, "INVALID_REQUEST");
  }

  @Test
  void refreshUnauthorizedDoesNotDeletePossiblyNewerBrowserCookie() throws Exception {
    when(sessions.refresh(any())).thenThrow(new BusinessException(ErrorCode.UNAUTHORIZED));
    var response = post("/refresh", "", "Origin", ORIGIN, "Cookie", "peakorderRefreshToken=" + RAW);
    error(response, 401, "UNAUTHORIZED");
    assertThat(response.headers().firstValue("set-cookie")).isEmpty();
  }

  @Test
  void logoutNeedsNoAccessAndReturnsBodylessIdempotent204() throws Exception {
    for (int i = 0; i < 2; i++) {
      var response = post("/logout", "", "Origin", ORIGIN);
      assertThat(response.statusCode()).isEqualTo(204);
      assertThat(response.body()).isEmpty();
      assertThat(response.headers().firstValue("set-cookie").orElseThrow()).contains("Max-Age=0");
    }
    verify(sessions, times(2)).logout(null);
  }

  @Test
  void meRequiresBearerAndIgnoresSpoofedIdentity() throws Exception {
    error(get("/me", "X-User-Id", "42", "X-User-Role", "STORE_ADMIN"), 401, "UNAUTHORIZED");
    var response = get("/me", "Authorization", "Bearer synthetic-access");
    assertThat(response.statusCode()).isEqualTo(200);
    assertThat(json.readTree(response.body()).path("data").path("nickname").isNull()).isTrue();
    error(get("/me", "Authorization", "Bearer first, Bearer second"), 401, "UNAUTHORIZED");
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "",
        "Basic credentials",
        "Bearer ",
        "Bearer first, Bearer second",
        "Bearer rejected-access"
      })
  void meUnauthorizedAlwaysIncludesBearerChallenge(String authorization) throws Exception {
    when(sessions.currentUser("rejected-access"))
        .thenThrow(new BusinessException(ErrorCode.UNAUTHORIZED));
    var response =
        authorization.isEmpty() ? get("/me") : get("/me", "Authorization", authorization);
    error(response, 401, "UNAUTHORIZED");
    assertThat(response.headers().firstValue("www-authenticate")).contains("Bearer");
    assertThat(response.headers().firstValue("cache-control")).contains("no-store");
  }

  @Test
  void nonBearerEndpointsAndUnavailableServiceDoNotAdvertiseBearerAuthentication()
      throws Exception {
    when(sessions.login(any())).thenThrow(new BusinessException(ErrorCode.UNAUTHORIZED));
    var login =
        post(
            "/login",
            "{\"email\":\"member@example.test\",\"password\":\"wrong\"}",
            "Origin",
            ORIGIN);
    error(login, 401, "UNAUTHORIZED");
    assertThat(login.headers().firstValue("www-authenticate")).isEmpty();
    when(sessions.refresh(any())).thenThrow(new BusinessException(ErrorCode.UNAUTHORIZED));
    var refresh = post("/refresh", "", "Origin", ORIGIN);
    error(refresh, 401, "UNAUTHORIZED");
    assertThat(refresh.headers().firstValue("www-authenticate")).isEmpty();
    when(sessions.currentUser("synthetic-access"))
        .thenThrow(new BusinessException(ErrorCode.AUTHENTICATION_UNAVAILABLE));
    var unavailable = get("/me", "Authorization", "Bearer synthetic-access");
    error(unavailable, 503, "AUTHENTICATION_UNAVAILABLE");
    assertThat(unavailable.headers().firstValue("www-authenticate")).isEmpty();
  }

  @Test
  void loginAllowsPaddedMaximumLengthEmailButBoundsRawInput() throws Exception {
    String email =
        "a".repeat(64) + "@" + "b".repeat(63) + "." + "c".repeat(63) + "." + "d".repeat(61);
    assertThat(email).hasSize(254);
    var accepted =
        post(
            "/login",
            json.writeValueAsString(Map.of("email", " " + email + " ", "password", "valid")),
            "Origin",
            ORIGIN);
    assertThat(accepted.statusCode()).isEqualTo(200);
    verify(sessions).login(argThat(body -> body.email().equals(" " + email + " ")));
    clearInvocations(sessions);
    error(
        post(
            "/login",
            json.writeValueAsString(Map.of("email", " ".repeat(771) + email, "password", "valid")),
            "Origin",
            ORIGIN),
        400,
        "INVALID_REQUEST");
    verify(sessions, never()).login(any());
  }

  @Test
  void publicKeyEndpointReturnsStandardJwkSetInsteadOfBusinessEnvelope() throws Exception {
    var response = get("/jwks");
    assertThat(response.statusCode()).isEqualTo(200);
    assertThat(json.readTree(response.body()).path("keys").isArray()).isTrue();
    assertThat(response.body()).doesNotContain("success", "private");
  }

  private HttpResponse<String> post(String path, String body, String... headers) throws Exception {
    return send(path, body, headers);
  }

  private HttpResponse<String> get(String path, String... headers) throws Exception {
    return send(path, null, headers);
  }

  private HttpResponse<String> send(String path, String body, String... headers) throws Exception {
    var request =
        HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + "/api/v1/auth" + path))
            .timeout(Duration.ofSeconds(15));
    if (body == null) request.GET();
    else
      request
          .header("Content-Type", "application/json")
          .POST(HttpRequest.BodyPublishers.ofString(body));
    if (headers.length > 0) request.headers(headers);
    try (var client = HttpClient.newHttpClient()) {
      return client.send(request.build(), HttpResponse.BodyHandlers.ofString());
    }
  }

  private void error(HttpResponse<String> response, int status, String code) throws Exception {
    assertThat(response.statusCode()).isEqualTo(status);
    var body = json.readTree(response.body());
    assertThat(body.path("success").asBoolean()).isFalse();
    assertThat(body.path("data").isNull()).isTrue();
    assertThat(body.path("errorCode").asString()).isEqualTo(code);
  }
}
