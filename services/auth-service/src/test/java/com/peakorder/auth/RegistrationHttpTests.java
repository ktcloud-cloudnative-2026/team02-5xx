package com.peakorder.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.peakorder.auth.dto.EmailAvailabilityResponse;
import com.peakorder.auth.dto.RegistrationResponse;
import com.peakorder.auth.exception.BusinessException;
import com.peakorder.auth.exception.ErrorCode;
import com.peakorder.auth.service.RegistrationService;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import tools.jackson.databind.ObjectMapper;

@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties =
        "spring.autoconfigure.exclude=org.springframework.boot.jdbc.autoconfigure.DataSourceAutoConfiguration")
class RegistrationHttpTests {
  @MockitoBean private RegistrationService registration;
  @Autowired private PasswordEncoder passwords;
  @LocalServerPort private int port;
  private final ObjectMapper json = new ObjectMapper();

  private static final String VALID_BODY =
      """
      {"email":"member@example.test","password":"local test password",
       "agreements":[{"type":"TERMS","version":"local-test-v1","agreed":true},
                     {"type":"PRIVACY","version":"local-test-v1","agreed":true}]}
      """;

  @Test
  void returnsCreatedMemberWithoutSecrets() throws Exception {
    when(registration.register(any()))
        .thenReturn(new RegistrationResponse(42L, "member@example.test"));
    var response = post(VALID_BODY);
    var body = json.readTree(response.body());
    assertThat(response.statusCode()).isEqualTo(201);
    assertThat(body.path("success").asBoolean()).isTrue();
    assertThat(body.path("data").path("id").asLong()).isEqualTo(42L);
    assertThat(body.path("data").path("email").asString()).isEqualTo("member@example.test");
    assertThat(response.body()).doesNotContain("password", "passwordHash", "errorCode");
  }

  @Test
  void returnsEmailAvailability() throws Exception {
    when(registration.checkEmail("member@example.test"))
        .thenReturn(new EmailAvailabilityResponse("member@example.test", true));
    var response = get("/api/v1/auth/email-availability?email=member%40example.test");
    assertThat(response.statusCode()).isEqualTo(200);
    assertThat(json.readTree(response.body()).path("data").path("available").asBoolean()).isTrue();
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "{}",
        "null",
        "{",
        "{\"email\":\"a@example.test\"}",
        "{\"email\":\"a@example.test\",\"password\":\"valid password\",\"agreements\":[null]}"
      })
  void rejectsMalformedOrIncompleteRequests(String input) throws Exception {
    var response = post(input);
    assertError(response, 400, "INVALID_REQUEST");
    verifyNoInteractions(registration);
  }

  @ParameterizedTest
  @ValueSource(strings = {"role", "status", "passwordHash", "nickname"})
  void rejectsUncontractedFields(String field) throws Exception {
    String input =
        VALID_BODY.stripTrailing().replaceFirst("\\}$", ",\"" + field + "\":\"STORE_ADMIN\"}");
    assertError(post(input), 400, "INVALID_REQUEST");
    verifyNoInteractions(registration);
  }

  @Test
  void mapsDuplicateEmailToConflict() throws Exception {
    when(registration.register(any()))
        .thenThrow(new BusinessException(ErrorCode.EMAIL_ALREADY_EXISTS));
    assertError(post(VALID_BODY), 409, "EMAIL_ALREADY_EXISTS");
  }

  @Test
  void protectsUnexpectedExceptionDetails() throws Exception {
    when(registration.register(any()))
        .thenThrow(new IllegalStateException("private-test-database-detail"));
    var response = post(VALID_BODY);
    assertError(response, 500, "INTERNAL_SERVER_ERROR");
    assertThat(response.body())
        .doesNotContain("private-test-database-detail", "IllegalStateException");
  }

  @Test
  void missingEmailParameterReturnsBadRequest() throws Exception {
    assertError(get("/api/v1/auth/email-availability"), 400, "INVALID_REQUEST");
  }

  @Test
  void unknownRouteUsesCommonEnvelope() throws Exception {
    assertError(get("/api/v1/auth/unknown"), 404, "NOT_FOUND");
  }

  @Test
  void unsupportedMethodUsesCommonEnvelope() throws Exception {
    var request =
        HttpRequest.newBuilder(uri("/api/v1/auth/register"))
            .DELETE()
            .timeout(Duration.ofSeconds(10))
            .build();
    assertError(send(request), 405, "METHOD_NOT_ALLOWED");
  }

  @Test
  void unsupportedContentTypeUsesCommonEnvelope() throws Exception {
    var request =
        HttpRequest.newBuilder(uri("/api/v1/auth/register"))
            .header("Content-Type", "text/plain")
            .POST(HttpRequest.BodyPublishers.ofString(VALID_BODY))
            .timeout(Duration.ofSeconds(10))
            .build();
    assertError(send(request), 415, "UNSUPPORTED_MEDIA_TYPE");
  }

  @Test
  void configuredArgon2idUsesSaltAndMatchesWithoutTrimming() {
    String password = "  unicode 암호 😀 test  ";
    String first = passwords.encode(password);
    String second = passwords.encode(password);
    assertThat(first).startsWith("$argon2id$v=19$m=19456,t=2,p=1$").isNotEqualTo(second);
    assertThat(passwords.matches(password, first)).isTrue();
    assertThat(passwords.matches(password.strip(), first)).isFalse();
    assertThat(passwords.matches("wrong password", first)).isFalse();
  }

  private void assertError(HttpResponse<String> response, int status, String code)
      throws Exception {
    var body = json.readTree(response.body());
    assertThat(response.statusCode()).isEqualTo(status);
    assertThat(body.path("success").asBoolean()).isFalse();
    assertThat(body.has("data")).isTrue();
    assertThat(body.path("data").isNull()).isTrue();
    assertThat(body.path("errorCode").asString()).isEqualTo(code);
  }

  private HttpResponse<String> post(String body) throws Exception {
    var request =
        HttpRequest.newBuilder(uri("/api/v1/auth/register"))
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(body))
            .timeout(Duration.ofSeconds(10))
            .build();
    return send(request);
  }

  private HttpResponse<String> get(String path) throws Exception {
    return send(HttpRequest.newBuilder(uri(path)).GET().timeout(Duration.ofSeconds(10)).build());
  }

  private URI uri(String path) {
    return URI.create("http://127.0.0.1:" + port + path);
  }

  private HttpResponse<String> send(HttpRequest request) throws Exception {
    try (var client = HttpClient.newHttpClient()) {
      return client.send(request, HttpResponse.BodyHandlers.ofString());
    }
  }
}
