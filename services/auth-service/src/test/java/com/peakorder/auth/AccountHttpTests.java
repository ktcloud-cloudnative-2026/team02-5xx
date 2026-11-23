package com.peakorder.auth;

import static com.peakorder.auth.AuthSessionTestSupport.*;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.peakorder.auth.config.SessionCookiePolicy;
import com.peakorder.auth.dto.CurrentUserResponse;
import com.peakorder.auth.dto.ProfileUpdateRequest;
import com.peakorder.auth.entity.UserRole;
import com.peakorder.auth.exception.BusinessException;
import com.peakorder.auth.exception.ErrorCode;
import com.peakorder.auth.service.AccountService;
import com.peakorder.auth.service.RegistrationService;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Clock;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
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
class AccountHttpTests {
  private static final String PROFILE = "{\"nickname\":\"member\"}";
  private static final String PASSWORD =
      "{\"currentPassword\":\"current local password\",\"newPassword\":\"changed local password\"}";
  @MockitoBean private RegistrationService registration;
  @MockitoBean private AccountService accounts;
  @LocalServerPort private int port;
  private final ObjectMapper json = new ObjectMapper();

  @TestConfiguration
  static class Cookies {
    @Bean
    SessionCookiePolicy sessionCookiePolicy() {
      return new SessionCookiePolicy(properties(), Clock.systemUTC());
    }
  }

  @BeforeEach
  void setup() {
    when(accounts.updateProfile(eq("synthetic-access"), any()))
        .thenAnswer(
            call ->
                new CurrentUserResponse(
                    42L,
                    "member@example.test",
                    ((ProfileUpdateRequest) call.getArgument(1)).nickname(),
                    UserRole.CUSTOMER));
  }

  @Test
  void profileResponseUsesMeShapeAndPreservesWhitespace() throws Exception {
    var result = authorized("/me", json.writeValueAsString(Map.of("nickname", "  닉네임  ")));
    assertThat(result.statusCode()).isEqualTo(200);
    var body = json.readTree(result.body());
    assertThat(body.path("success").asBoolean()).isTrue();
    assertThat(body.path("data").path("id").asLong()).isEqualTo(42);
    assertThat(body.path("data").path("nickname").asString()).isEqualTo("  닉네임  ");
    assertThat(body.path("data").path("role").asString()).isEqualTo("CUSTOMER");
    assertThat(result.headers().firstValue("cache-control")).contains("no-store");
    assertThat(result.headers().firstValue("set-cookie")).isEmpty();
  }

  @Test
  void passwordSuccessHasNoJsonAndDeletesOnlyRefreshCookie() throws Exception {
    var result = authorized("/me/password", PASSWORD);
    assertThat(result.statusCode()).isEqualTo(204);
    assertThat(result.body()).isEmpty();
    assertThat(result.headers().firstValue("cache-control")).contains("no-store");
    assertThat(result.headers().firstValue("set-cookie").orElseThrow())
        .contains(
            "peakorderRefreshToken=",
            "Max-Age=0",
            "Secure",
            "HttpOnly",
            "SameSite=Strict",
            "Path=/api/v1/auth");
    verify(accounts).changePassword(eq("synthetic-access"), any());
  }

  @Test
  void nicknameNullBlankOverlongAndPrivilegeFieldsAreRejected() throws Exception {
    for (String body :
        new String[] {
          "{}",
          "{\"nickname\":null}",
          "{\"nickname\":\"\"}",
          "{\"nickname\":\"   \"}",
          "{\"nickname\":\"a\",\"role\":\"STORE_ADMIN\"}",
          "{\"nickname\":\"a\",\"userId\":99}"
        }) {
      error(authorized("/me", body), 400, "INVALID_REQUEST");
    }
    error(
        authorized("/me", json.writeValueAsString(Map.of("nickname", "😀".repeat(51)))),
        400,
        "INVALID_REQUEST");
    verifyNoInteractions(accounts);
  }

  @Test
  void fiftyUnicodeCodePointsAreAllowed() throws Exception {
    assertThat(
            authorized("/me", json.writeValueAsString(Map.of("nickname", "😀".repeat(50))))
                .statusCode())
        .isEqualTo(200);
  }

  @Test
  void passwordUnknownFieldsAndMissingValuesAreRejected() throws Exception {
    for (String body :
        new String[] {
          "{}",
          "{\"currentPassword\":null,\"newPassword\":\"valid password\"}",
          "{\"currentPassword\":\"valid password\",\"newPassword\":null}",
          PASSWORD.substring(0, PASSWORD.length() - 1) + ",\"userId\":99}"
        }) {
      error(authorized("/me/password", body), 400, "INVALID_REQUEST");
    }
    verifyNoInteractions(accounts);
  }

  @Test
  void bothRoutesRejectMissingMalformedAndDuplicateAuthorization() throws Exception {
    for (String path : new String[] {"/me", "/me/password"}) {
      String body = path.equals("/me") ? PROFILE : PASSWORD;
      error(patch(path, body), 401, "UNAUTHORIZED");
      for (String value : new String[] {"Basic abc", "Bearer ", "Bearer a b", "Bearer a,b"})
        error(patch(path, body, "Authorization", value), 401, "UNAUTHORIZED");
      error(
          patch(path, body, "Authorization", "Bearer one", "Authorization", "Bearer two"),
          401,
          "UNAUTHORIZED");
    }
    verifyNoInteractions(accounts);
  }

  @Test
  void rejectedTokenHasBearerChallengeAndNoCookie() throws Exception {
    when(accounts.updateProfile(anyString(), any()))
        .thenThrow(new BusinessException(ErrorCode.UNAUTHORIZED));
    var result = authorized("/me", PROFILE);
    error(result, 401, "UNAUTHORIZED");
    assertThat(result.headers().firstValue("www-authenticate")).contains("Bearer");
    assertThat(result.headers().firstValue("cache-control")).contains("no-store");
  }

  @Test
  void wrongPasswordIsFieldErrorWithoutClearingCookie() throws Exception {
    doThrow(new BusinessException(ErrorCode.CURRENT_PASSWORD_MISMATCH))
        .when(accounts)
        .changePassword(anyString(), any());
    var result = authorized("/me/password", PASSWORD);
    error(result, 400, "CURRENT_PASSWORD_MISMATCH");
    assertThat(result.headers().firstValue("www-authenticate")).isEmpty();
  }

  @Test
  void forbiddenRoleDoesNotClearCookieOrBecomeUnauthorized() throws Exception {
    doThrow(new BusinessException(ErrorCode.FORBIDDEN))
        .when(accounts)
        .changePassword(anyString(), any());
    error(authorized("/me/password", PASSWORD), 403, "FORBIDDEN");
  }

  private HttpResponse<String> authorized(String path, String body) throws Exception {
    return patch(path, body, "Authorization", "Bearer synthetic-access");
  }

  private HttpResponse<String> patch(String path, String body, String... headers) throws Exception {
    var builder =
        HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + "/api/v1/auth" + path))
            .header("Content-Type", "application/json")
            .method("PATCH", HttpRequest.BodyPublishers.ofString(body));
    if (headers.length > 0) builder.headers(headers);
    try (var client = HttpClient.newHttpClient()) {
      return client.send(builder.build(), HttpResponse.BodyHandlers.ofString());
    }
  }

  private void error(HttpResponse<String> result, int status, String code) {
    assertThat(result.statusCode()).isEqualTo(status);
    assertThat(json.readTree(result.body()).path("errorCode").asString()).isEqualTo(code);
    assertThat(result.headers().firstValue("set-cookie")).isEmpty();
  }
}
