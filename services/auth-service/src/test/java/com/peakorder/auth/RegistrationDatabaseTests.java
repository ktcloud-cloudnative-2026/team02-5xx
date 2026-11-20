package com.peakorder.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;

import com.peakorder.auth.repository.UserAgreementRepository;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import tools.jackson.databind.ObjectMapper;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@EnabledIfEnvironmentVariable(named = "AUTH_DB_TEST_URL", matches = ".+")
class RegistrationDatabaseTests {
  @Autowired private JdbcTemplate jdbc;
  @Autowired private Flyway flyway;
  @Autowired private PasswordEncoder passwords;
  @MockitoSpyBean private UserAgreementRepository agreements;
  @LocalServerPort private int port;
  private final ObjectMapper json = new ObjectMapper();

  @DynamicPropertySource
  static void localDatabase(DynamicPropertyRegistry registry) {
    String url = System.getenv("AUTH_DB_TEST_URL");
    if (url == null
        || !url.matches(
            "jdbc:postgresql://(127\\.0\\.0\\.1|localhost):[0-9]+/auth_registration_test")) {
      throw new IllegalArgumentException("Use an isolated local auth_registration_test database");
    }
    registry.add("spring.datasource.url", () -> url);
    registry.add("spring.datasource.username", () -> System.getenv("AUTH_DB_TEST_USERNAME"));
    registry.add("spring.datasource.password", () -> System.getenv("AUTH_DB_TEST_PASSWORD"));
    registry.add("auth.registration.terms-version", () -> "local-test-v1");
    registry.add("auth.registration.privacy-version", () -> "local-test-v1");
  }

  @BeforeEach
  void clearLocalTestData() {
    jdbc.execute("TRUNCATE TABLE refresh_tokens, user_agreements, users RESTART IDENTITY");
  }

  @Test
  void appliesAndValidatesMigration() {
    assertThat(flyway.validateWithResult().validationSuccessful).isTrue();
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM flyway_schema_history WHERE version = '1' AND success",
                Integer.class))
        .isEqualTo(1);
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM pg_constraint WHERE conname = 'uk_users_email'",
                Integer.class))
        .isEqualTo(1);
  }

  @Test
  void persistsMemberAndBothAgreementsWithArgon2id() throws Exception {
    var response = register("member@example.test");
    assertThat(response.statusCode()).isEqualTo(201);
    var body = json.readTree(response.body());
    assertThat(body.path("data").path("id").asLong()).isPositive();
    assertThat(jdbc.queryForObject("SELECT count(*) FROM users", Integer.class)).isEqualTo(1);
    assertThat(
            jdbc.queryForObject("SELECT count(*) FROM user_agreements WHERE agreed", Integer.class))
        .isEqualTo(2);
    var row =
        jdbc.queryForMap("SELECT password_hash, role, status, nickname, name, phone FROM users");
    String hash = (String) row.get("password_hash");
    assertThat(hash).startsWith("$argon2id$");
    assertThat(passwords.matches("local test password", hash)).isTrue();
    assertThat(row.get("role")).isEqualTo("CUSTOMER");
    assertThat(row.get("status")).isEqualTo("ACTIVE");
    assertThat(row.get("nickname")).isNull();
    assertThat(row.get("name")).isNull();
    assertThat(row.get("phone")).isNull();
    assertThat(response.body()).doesNotContain("password", "argon2", hash);
  }

  @Test
  void normalizesEmailAcrossAvailabilityAndRegistration() throws Exception {
    assertThat(register(" Member@EXAMPLE.TEST ").statusCode()).isEqualTo(201);
    var availability = get("/api/v1/auth/email-availability?email=Member%40Example.Test");
    assertThat(json.readTree(availability.body()).path("data").path("available").asBoolean())
        .isFalse();
    assertThat(register("Member@example.test").statusCode()).isEqualTo(409);
    assertThat(jdbc.queryForObject("SELECT email FROM users", String.class))
        .isEqualTo("Member@example.test");
    assertThat(jdbc.queryForObject("SELECT count(*) FROM user_agreements", Integer.class))
        .isEqualTo(2);
  }

  @Test
  void databaseEnforcesUniqueEmail() throws Exception {
    register("member@example.test");
    assertThatThrownBy(
            () ->
                jdbc.update(
                    "INSERT INTO users (email, password_hash, role, status, created_at, updated_at) "
                        + "SELECT email, password_hash, role, status, created_at, updated_at FROM users"))
        .isInstanceOf(DataIntegrityViolationException.class);
    assertThat(jdbc.queryForObject("SELECT count(*) FROM users", Integer.class)).isEqualTo(1);
  }

  @Test
  void concurrentRegistrationsCreateExactlyOneMember() throws Exception {
    var start = new CountDownLatch(1);
    try (var executor = Executors.newFixedThreadPool(2)) {
      var futures =
          List.of(
              executor.submit(
                  () -> {
                    start.await();
                    return register("race@example.test").statusCode();
                  }),
              executor.submit(
                  () -> {
                    start.await();
                    return register("race@example.test").statusCode();
                  }));
      start.countDown();
      assertThat(
              List.of(
                  futures.getFirst().get(30, TimeUnit.SECONDS),
                  futures.getLast().get(30, TimeUnit.SECONDS)))
          .containsExactlyInAnyOrder(201, 409);
    }
    assertThat(jdbc.queryForObject("SELECT count(*) FROM users", Integer.class)).isEqualTo(1);
    assertThat(jdbc.queryForObject("SELECT count(*) FROM user_agreements", Integer.class))
        .isEqualTo(2);
  }

  @Test
  void rollsBackMemberWhenAgreementSaveFails() throws Exception {
    doThrow(new DataIntegrityViolationException("simulated agreement failure"))
        .when(agreements)
        .saveAllAndFlush(any());
    var response = register("rollback@example.test");
    assertThat(response.statusCode()).isEqualTo(500);
    assertThat(json.readTree(response.body()).path("errorCode").asString())
        .isEqualTo("INTERNAL_SERVER_ERROR");
    assertThat(jdbc.queryForObject("SELECT count(*) FROM users", Integer.class)).isZero();
    assertThat(jdbc.queryForObject("SELECT count(*) FROM user_agreements", Integer.class)).isZero();
  }

  @Test
  void invalidAgreementDoesNotPersistAnything() throws Exception {
    var response = post(requestBody("member@example.test").replace("local-test-v1", "unapproved"));
    assertThat(response.statusCode()).isEqualTo(400);
    assertThat(json.readTree(response.body()).path("errorCode").asString())
        .isEqualTo("INVALID_AGREEMENT_VERSION");
    assertThat(jdbc.queryForObject("SELECT count(*) FROM users", Integer.class)).isZero();
  }

  @Test
  void exposesRegistrationApisAndSwaggerWithRealDatabase() throws Exception {
    var response = get("/v3/api-docs");
    assertThat(response.statusCode()).isEqualTo(200);
    var paths = json.readTree(response.body()).path("paths");
    assertThat(paths.has("/api/v1/auth/register")).isTrue();
    assertThat(paths.has("/api/v1/auth/email-availability")).isTrue();
    assertThat(get("/swagger-ui/index.html").statusCode()).isEqualTo(200);
  }

  private HttpResponse<String> register(String email) throws Exception {
    return post(requestBody(email));
  }

  private String requestBody(String email) {
    return """
        {"email":"%s","password":"local test password",
         "agreements":[{"type":"TERMS","version":"local-test-v1","agreed":true},
                       {"type":"PRIVACY","version":"local-test-v1","agreed":true}]}
        """
        .formatted(email);
  }

  private HttpResponse<String> post(String body) throws Exception {
    return send(
        HttpRequest.newBuilder(uri("/api/v1/auth/register"))
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(body))
            .timeout(Duration.ofSeconds(20))
            .build());
  }

  private HttpResponse<String> get(String path) throws Exception {
    return send(HttpRequest.newBuilder(uri(path)).GET().timeout(Duration.ofSeconds(20)).build());
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
