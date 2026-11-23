package com.peakorder.auth;

import static com.peakorder.auth.AuthSessionTestSupport.*;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;

import com.peakorder.auth.entity.User;
import com.peakorder.auth.repository.RefreshTokenRepository;
import com.peakorder.auth.repository.UserRepository;
import com.peakorder.auth.service.SessionService;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterAll;
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

@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = "auth.session.enabled=true")
@EnabledIfEnvironmentVariable(named = "AUTH_DB_TEST_URL", matches = ".+")
class SessionDatabaseTests {
  private static final Path KEY_FILES = generatedKeys();
  private static final String PASSWORD = "local session test password";
  @Autowired private JdbcTemplate jdbc;
  @Autowired private UserRepository users;
  @Autowired private PasswordEncoder passwords;
  @Autowired private Flyway flyway;
  @MockitoSpyBean private RefreshTokenRepository refreshes;
  @LocalServerPort private int port;
  private final ObjectMapper json = new ObjectMapper();
  private User member;

  @DynamicPropertySource
  static void isolatedDatabase(DynamicPropertyRegistry registry) {
    String url = System.getenv("AUTH_DB_TEST_URL");
    if (url == null
        || !url.matches(
            "jdbc:postgresql://(127\\.0\\.0\\.1|localhost):[0-9]+/auth_registration_test"))
      throw new IllegalArgumentException("Use an isolated local auth_registration_test database");
    registry.add("spring.datasource.url", () -> url);
    registry.add("spring.datasource.username", () -> System.getenv("AUTH_DB_TEST_USERNAME"));
    registry.add("spring.datasource.password", () -> System.getenv("AUTH_DB_TEST_PASSWORD"));
    registry.add("auth.registration.terms-version", () -> "local-test-v1");
    registry.add("auth.registration.privacy-version", () -> "local-test-v1");
    registry.add("auth.session.issuer", () -> properties().issuer());
    registry.add("auth.session.audience", () -> properties().audience());
    registry.add("auth.session.key-id", () -> properties().keyId());
    registry.add(
        "auth.session.private-key-file", () -> KEY_FILES.resolve("private.pem").toString());
    registry.add("auth.session.public-key-file", () -> KEY_FILES.resolve("public.pem").toString());
    registry.add("auth.session.allowed-origins", () -> ORIGIN);
  }

  @BeforeEach
  void reset() {
    jdbc.execute("TRUNCATE TABLE refresh_tokens, user_agreements, users RESTART IDENTITY");
    member =
        users.saveAndFlush(
            new User("member@example.test", passwords.encode(PASSWORD), Instant.now()));
  }

  @AfterAll
  static void removeOnlyGeneratedKeys() throws Exception {
    Files.deleteIfExists(KEY_FILES.resolve("private.pem"));
    Files.deleteIfExists(KEY_FILES.resolve("public.pem"));
    Files.deleteIfExists(KEY_FILES);
  }

  @Test
  void completeLoginMeRotateLogoutFlowWithRealJwtAndHashedRefresh() throws Exception {
    var first = login(false);
    String firstCookie = cookie(first);
    String firstRaw = raw(firstCookie);
    String access = json.readTree(first.body()).path("data").path("accessToken").asString();
    assertThat(getMe(access).statusCode()).isEqualTo(200);
    try (var client = HttpClient.newHttpClient()) {
      var publicResponse =
          client.send(
              HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + "/api/v1/auth/jwks"))
                  .GET()
                  .build(),
              HttpResponse.BodyHandlers.ofString());
      assertThat(publicResponse.statusCode()).isEqualTo(200);
      var published = com.nimbusds.jose.jwk.JWKSet.parse(publicResponse.body());
      var signed = com.nimbusds.jwt.SignedJWT.parse(access);
      var publicKey = published.getKeyByKeyId(signed.getHeader().getKeyID()).toRSAKey();
      assertThat(publicKey.isPrivate()).isFalse();
      assertThat(signed.verify(new com.nimbusds.jose.crypto.RSASSAVerifier(publicKey))).isTrue();
    }
    assertThat(first.body()).doesNotContain(firstRaw, "passwordHash", "refreshToken");
    assertThat(jdbc.queryForObject("SELECT token_hash FROM refresh_tokens", String.class))
        .isEqualTo(SessionService.tokenHash(firstRaw))
        .isNotEqualTo(firstRaw);
    var rotated = post("/refresh", "", firstCookie);
    assertThat(rotated.statusCode()).isEqualTo(200);
    assertThat(active()).isEqualTo(1);
    assertThat(jdbc.queryForObject("SELECT count(*) FROM refresh_tokens WHERE revoked", Long.class))
        .isEqualTo(1);
    assertThat(post("/logout", "", cookie(rotated)).statusCode()).isEqualTo(204);
    assertThat(post("/logout", "", cookie(rotated)).statusCode()).isEqualTo(204);
    assertThat(post("/refresh", "", cookie(rotated)).statusCode()).isEqualTo(401);
    assertThat(active()).isZero();
    // Access is stateless; current-session logout does not promise immediate Access revocation.
    assertThat(getMe(access).statusCode()).isEqualTo(200);
  }

  @Test
  void replayRevocationIsCommittedAndOtherLoginSessionSurvives() throws Exception {
    String a = cookie(login(false));
    String b = cookie(login(false));
    String currentA = cookie(post("/refresh", "", a));
    assertThat(post("/refresh", "", a).statusCode()).isEqualTo(401);
    assertThat(active()).isEqualTo(1);
    assertThat(post("/refresh", "", currentA).statusCode()).isEqualTo(401);
    assertThat(post("/refresh", "", b).statusCode()).isEqualTo(200);
    assertThat(active()).isEqualTo(1);
  }

  @Test
  void sameRefreshConcurrentRequestsHaveOneSuccessAndStrictReplayRevokesFamily() throws Exception {
    String original = cookie(login(false));
    CountDownLatch gate = new CountDownLatch(1);
    try (var executor = Executors.newFixedThreadPool(2)) {
      var calls =
          java.util.stream.IntStream.range(0, 2)
              .mapToObj(
                  i ->
                      executor.submit(
                          () -> {
                            gate.await();
                            return post("/refresh", "", original).statusCode();
                          }))
              .toList();
      gate.countDown();
      var results =
          List.of(calls.get(0).get(20, TimeUnit.SECONDS), calls.get(1).get(20, TimeUnit.SECONDS));
      assertThat(results).containsExactlyInAnyOrder(200, 401);
    }
    assertThat(active()).isZero();
  }

  @Test
  void logoutRacingRefreshLeavesNoActiveTokenInThatSession() throws Exception {
    String original = cookie(login(false));
    CountDownLatch gate = new CountDownLatch(1);
    try (var executor = Executors.newFixedThreadPool(2)) {
      var rotation =
          executor.submit(
              () -> {
                gate.await();
                return post("/refresh", "", original).statusCode();
              });
      var logout =
          executor.submit(
              () -> {
                gate.await();
                return post("/logout", "", original).statusCode();
              });
      gate.countDown();
      assertThat(rotation.get(20, TimeUnit.SECONDS)).isIn(200, 401);
      assertThat(logout.get(20, TimeUnit.SECONDS)).isEqualTo(204);
    }
    assertThat(active()).isZero();
  }

  @Test
  void failedInsertRollsBackOldTokenRevocation() throws Exception {
    String original = cookie(login(false));
    doThrow(new DataIntegrityViolationException("synthetic token insert failure"))
        .when(refreshes)
        .saveAndFlush(any());
    var result = post("/refresh", "", original);
    assertThat(result.statusCode()).isEqualTo(500);
    assertThat(active()).isEqualTo(1);
    assertThat(jdbc.queryForObject("SELECT count(*) FROM refresh_tokens", Long.class)).isEqualTo(1);
    assertThat(result.headers().firstValue("set-cookie")).isEmpty();
  }

  @Test
  void suspendedAccountCannotLoginReadMeOrRefreshAndRevocationCommits() throws Exception {
    var loggedIn = login(false);
    String access = json.readTree(loggedIn.body()).path("data").path("accessToken").asString();
    jdbc.update("UPDATE users SET status = 'SUSPENDED' WHERE id = ?", member.getId());
    assertThat(getMe(access).statusCode()).isEqualTo(401);
    assertThat(post("/refresh", "", cookie(loggedIn)).statusCode()).isEqualTo(401);
    assertThat(active()).isZero();
    assertThat(post("/login", loginBody(false), null).statusCode()).isEqualTo(401);
  }

  @Test
  void rememberMeAndRotationKeepOriginalAbsoluteExpiry() throws Exception {
    Instant before = Instant.now();
    var loggedIn = login(true);
    Instant expires =
        jdbc.queryForObject("SELECT expires_at FROM refresh_tokens", java.sql.Timestamp.class)
            .toInstant();
    assertThat(expires).isBetween(before.plusSeconds(1209599), Instant.now().plusSeconds(1209601));
    assertThat(loggedIn.headers().firstValue("set-cookie").orElseThrow()).contains("Max-Age=");
    assertThat(post("/refresh", "", cookie(loggedIn)).statusCode()).isEqualTo(200);
    assertThat(
            jdbc
                .queryForList("SELECT expires_at FROM refresh_tokens", java.sql.Timestamp.class)
                .stream()
                .map(java.sql.Timestamp::toInstant)
                .distinct())
        .containsExactly(expires);
  }

  @Test
  void expiredSessionFailsAndBothMigrationsValidate() throws Exception {
    String original = cookie(login(false));
    jdbc.update(
        "UPDATE refresh_tokens SET created_at=now()-interval '2 days', expires_at=now()-interval '1 day'");
    assertThat(post("/refresh", "", original).statusCode()).isEqualTo(401);
    assertThat(active()).isZero();
    assertThat(flyway.validateWithResult().validationSuccessful).isTrue();
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM flyway_schema_history WHERE version IN ('1','2') AND success",
                Long.class))
        .isEqualTo(2);
  }

  @Test
  void profilePatchPersistsOnlyNicknameAndPreservesAccessAndPassword() throws Exception {
    var loggedIn = login(false);
    String access = accessOf(loggedIn);
    String hash =
        jdbc.queryForObject(
            "SELECT password_hash FROM users WHERE id=?", String.class, member.getId());
    var response =
        patch("/me", access, json.writeValueAsString(java.util.Map.of("nickname", "  DB닉네임😀  ")));
    assertThat(response.statusCode()).isEqualTo(200);
    assertThat(json.readTree(response.body()).path("data").path("nickname").asString())
        .isEqualTo("  DB닉네임😀  ");
    assertThat(
            jdbc.queryForObject(
                "SELECT nickname FROM users WHERE id=?", String.class, member.getId()))
        .isEqualTo("  DB닉네임😀  ");
    assertThat(
            jdbc.queryForObject(
                "SELECT password_hash FROM users WHERE id=?", String.class, member.getId()))
        .isEqualTo(hash);
    assertThat(active()).isEqualTo(1);
    assertThat(getMe(access).statusCode()).isEqualTo(200);
  }

  @Test
  void passwordChangeRevokesAllOwnSessionsButPreservesOtherUserAndExistingAccess()
      throws Exception {
    var first = login(false);
    var second = login(true);
    String rotated = cookie(post("/refresh", "", cookie(first)));
    var other =
        users.saveAndFlush(
            new User("other@example.test", passwords.encode(PASSWORD), Instant.now()));
    var otherLogin =
        post(
            "/login",
            json.writeValueAsString(
                java.util.Map.of("email", other.getEmail(), "password", PASSWORD)),
            null);
    assertThat(otherLogin.statusCode()).isEqualTo(200);
    String next = " changed local password ";
    var response = patch("/me/password", accessOf(first), passwordBody(PASSWORD, next));
    assertThat(response.statusCode()).isEqualTo(204);
    assertThat(response.body()).isEmpty();
    assertThat(response.headers().firstValue("set-cookie").orElseThrow())
        .contains("Max-Age=0", "HttpOnly", "Secure");
    String hash =
        jdbc.queryForObject(
            "SELECT password_hash FROM users WHERE id=?", String.class, member.getId());
    assertThat(hash).startsWith("$argon2id$");
    assertThat(passwords.matches(next, hash)).isTrue();
    assertThat(passwords.matches(PASSWORD, hash)).isFalse();
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM refresh_tokens WHERE user_id=? AND NOT revoked",
                Long.class,
                member.getId()))
        .isZero();
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM refresh_tokens WHERE user_id=? AND NOT revoked",
                Long.class,
                other.getId()))
        .isEqualTo(1);
    assertThat(post("/refresh", "", rotated).statusCode()).isEqualTo(401);
    assertThat(post("/refresh", "", cookie(second)).statusCode()).isEqualTo(401);
    assertThat(post("/refresh", "", cookie(otherLogin)).statusCode()).isEqualTo(200);
    assertThat(post("/login", loginBody(false), null).statusCode()).isEqualTo(401);
    assertThat(
            post(
                    "/login",
                    json.writeValueAsString(
                        java.util.Map.of("email", member.getEmail(), "password", next)),
                    null)
                .statusCode())
        .isEqualTo(200);
    assertThat(getMe(accessOf(first)).statusCode()).isEqualTo(200);
  }

  @Test
  void wrongCurrentPasswordDoesNotChangeHashOrRevokeSession() throws Exception {
    var loggedIn = login(false);
    String hash =
        jdbc.queryForObject(
            "SELECT password_hash FROM users WHERE id=?", String.class, member.getId());
    var response =
        patch(
            "/me/password",
            accessOf(loggedIn),
            passwordBody("wrong password", "changed local password"));
    assertThat(response.statusCode()).isEqualTo(400);
    assertThat(json.readTree(response.body()).path("errorCode").asString())
        .isEqualTo("CURRENT_PASSWORD_MISMATCH");
    assertThat(response.headers().firstValue("set-cookie")).isEmpty();
    assertThat(
            jdbc.queryForObject(
                "SELECT password_hash FROM users WHERE id=?", String.class, member.getId()))
        .isEqualTo(hash);
    assertThat(active()).isEqualTo(1);
  }

  @Test
  void profileAndPasswordUseCurrentDatabaseRoleAndStatus() throws Exception {
    String access = accessOf(login(false));
    jdbc.update("UPDATE users SET role='STORE_ADMIN' WHERE id=?", member.getId());
    assertThat(patch("/me", access, "{\"nickname\":\"member\"}").statusCode()).isEqualTo(403);
    assertThat(
            patch("/me/password", access, passwordBody(PASSWORD, "changed local password"))
                .statusCode())
        .isEqualTo(403);
    jdbc.update("UPDATE users SET role='CUSTOMER',status='SUSPENDED' WHERE id=?", member.getId());
    assertThat(patch("/me", access, "{\"nickname\":\"member\"}").statusCode()).isEqualTo(401);
    assertThat(
            patch("/me/password", access, passwordBody(PASSWORD, "changed local password"))
                .statusCode())
        .isEqualTo(401);
    assertThat(active()).isEqualTo(1);
  }

  @Test
  void failedGlobalRevocationRollsBackPasswordAndCookie() throws Exception {
    var loggedIn = login(false);
    String hash =
        jdbc.queryForObject(
            "SELECT password_hash FROM users WHERE id=?", String.class, member.getId());
    doThrow(new DataIntegrityViolationException("synthetic global revocation failure"))
        .when(refreshes)
        .revokeAllForUser(org.mockito.ArgumentMatchers.anyLong());
    var response =
        patch("/me/password", accessOf(loggedIn), passwordBody(PASSWORD, "changed local password"));
    assertThat(response.statusCode()).isEqualTo(500);
    assertThat(response.headers().firstValue("set-cookie")).isEmpty();
    assertThat(
            jdbc.queryForObject(
                "SELECT password_hash FROM users WHERE id=?", String.class, member.getId()))
        .isEqualTo(hash);
    assertThat(active()).isEqualTo(1);
  }

  @Test
  void refreshRacingPasswordChangeCannotLeaveAnActiveSession() throws Exception {
    var loggedIn = login(false);
    String access = accessOf(loggedIn);
    CountDownLatch gate = new CountDownLatch(1);
    try (var executor = Executors.newFixedThreadPool(2)) {
      var rotation =
          executor.submit(
              () -> {
                gate.await();
                return post("/refresh", "", cookie(loggedIn));
              });
      var change =
          executor.submit(
              () -> {
                gate.await();
                return patch(
                    "/me/password", access, passwordBody(PASSWORD, "changed local password"));
              });
      gate.countDown();
      var rotated = rotation.get(20, TimeUnit.SECONDS);
      assertThat(rotated.statusCode()).isIn(200, 401);
      assertThat(change.get(20, TimeUnit.SECONDS).statusCode()).isEqualTo(204);
      assertThat(active()).isZero();
      if (rotated.statusCode() == 200)
        assertThat(post("/refresh", "", cookie(rotated)).statusCode()).isEqualTo(401);
    }
  }

  @Test
  void competingPasswordChangesHaveOnlyOneSuccess() throws Exception {
    String access = accessOf(login(false));
    CountDownLatch gate = new CountDownLatch(1);
    try (var executor = Executors.newFixedThreadPool(2)) {
      var one =
          executor.submit(
              () -> {
                gate.await();
                return patch(
                    "/me/password", access, passwordBody(PASSWORD, "first changed password"));
              });
      var two =
          executor.submit(
              () -> {
                gate.await();
                return patch(
                    "/me/password", access, passwordBody(PASSWORD, "second changed password"));
              });
      gate.countDown();
      assertThat(
              List.of(
                  one.get(20, TimeUnit.SECONDS).statusCode(),
                  two.get(20, TimeUnit.SECONDS).statusCode()))
          .containsExactlyInAnyOrder(204, 400);
    }
    String hash =
        jdbc.queryForObject(
            "SELECT password_hash FROM users WHERE id=?", String.class, member.getId());
    assertThat(
            passwords.matches("first changed password", hash)
                ^ passwords.matches("second changed password", hash))
        .isTrue();
    assertThat(active()).isZero();
  }

  private String accessOf(HttpResponse<String> response) {
    return json.readTree(response.body()).path("data").path("accessToken").asString();
  }

  private String passwordBody(String current, String next) {
    return json.writeValueAsString(
        java.util.Map.of("currentPassword", current, "newPassword", next));
  }

  private HttpResponse<String> patch(String path, String access, String body) throws Exception {
    try (var client = HttpClient.newHttpClient()) {
      return client.send(
          HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + "/api/v1/auth" + path))
              .header("Authorization", "Bearer " + access)
              .header("Content-Type", "application/json")
              .timeout(java.time.Duration.ofSeconds(15))
              .method("PATCH", HttpRequest.BodyPublishers.ofString(body))
              .build(),
          HttpResponse.BodyHandlers.ofString());
    }
  }

  private long active() {
    return jdbc.queryForObject("SELECT count(*) FROM refresh_tokens WHERE NOT revoked", Long.class);
  }

  private HttpResponse<String> login(boolean rememberMe) throws Exception {
    var response = post("/login", loginBody(rememberMe), null);
    assertThat(response.statusCode()).isEqualTo(200);
    return response;
  }

  private String loginBody(boolean rememberMe) {
    return "{\"email\":\"member@example.test\",\"password\":\""
        + PASSWORD
        + "\",\"rememberMe\":"
        + rememberMe
        + "}";
  }

  private static String cookie(HttpResponse<String> response) {
    return response.headers().firstValue("set-cookie").orElseThrow().split(";", 2)[0];
  }

  private static String raw(String cookie) {
    return cookie.substring(cookie.indexOf('=') + 1);
  }

  private HttpResponse<String> post(String path, String body, String cookie) throws Exception {
    var request =
        HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + "/api/v1/auth" + path))
            .header("Origin", ORIGIN)
            .header("Content-Type", "application/json")
            .timeout(java.time.Duration.ofSeconds(15))
            .POST(HttpRequest.BodyPublishers.ofString(body));
    if (cookie != null) request.header("Cookie", cookie);
    try (var client = HttpClient.newHttpClient()) {
      return client.send(request.build(), HttpResponse.BodyHandlers.ofString());
    }
  }

  private HttpResponse<String> getMe(String access) throws Exception {
    try (var client = HttpClient.newHttpClient()) {
      return client.send(
          HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + "/api/v1/auth/me"))
              .header("Authorization", "Bearer " + access)
              .GET()
              .build(),
          HttpResponse.BodyHandlers.ofString());
    }
  }

  private static Path generatedKeys() {
    try {
      Path directory = Files.createTempDirectory("peakorder-auth149-junit-");
      writeKeys(directory);
      return directory;
    } catch (Exception exception) {
      throw new IllegalStateException("Unable to create temporary test keys");
    }
  }
}
