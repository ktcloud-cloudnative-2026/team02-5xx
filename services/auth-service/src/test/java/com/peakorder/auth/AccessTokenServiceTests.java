package com.peakorder.auth;

import static com.peakorder.auth.AuthSessionTestSupport.*;
import static org.assertj.core.api.Assertions.*;

import com.nimbusds.jose.JOSEObjectType;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import com.peakorder.auth.config.SessionProperties;
import com.peakorder.auth.exception.BusinessException;
import com.peakorder.auth.exception.ErrorCode;
import com.peakorder.auth.service.AccessTokenService;
import java.nio.file.Path;
import java.security.interfaces.RSAPrivateKey;
import java.security.interfaces.RSAPublicKey;
import java.time.Clock;
import java.time.ZoneOffset;
import java.util.Date;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

class AccessTokenServiceTests {
  private AccessTokenService service(Clock clock) {
    return new AccessTokenService(
        properties(), clock, (RSAPublicKey) KEYS.getPublic(), (RSAPrivateKey) KEYS.getPrivate());
  }

  @Test
  void issuesFifteenMinuteTokenAndOnlyPublishesPublicRsaMaterial() throws Exception {
    String raw = service(CLOCK).issue(user());
    var jwt = SignedJWT.parse(raw);
    assertThat(jwt.getHeader().getAlgorithm()).isEqualTo(JWSAlgorithm.RS256);
    assertThat(jwt.getHeader().getKeyID()).isEqualTo(properties().keyId());
    assertThat(jwt.getJWTClaimsSet().getSubject()).isEqualTo("42");
    assertThat(jwt.getJWTClaimsSet().getExpirationTime().toInstant())
        .isEqualTo(NOW.plusSeconds(900));
    assertThat(service(CLOCK).verify(raw)).isEqualTo(42);
    var keys = service(CLOCK).publicKeys();
    assertThat(keys.toString())
        .contains("RSA", "local-test-key")
        .doesNotContain("private", "password");
    var jwk = (java.util.Map<?, ?>) ((java.util.List<?>) keys.get("keys")).getFirst();
    for (String name : java.util.List.of("d", "p", "q", "dp", "dq", "qi", "k"))
      assertThat(jwk.containsKey(name)).isFalse();
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "missingExpiry",
        "missingIssuedAt",
        "wrongIssuer",
        "wrongAudience",
        "badRole",
        "missingRole",
        "zeroSubject",
        "overflowSubject",
        "futureIssuedAt",
        "longLifetime",
        "wrongKid",
        "wrongType"
      })
  void rejectsSignedButUntrustedClaims(String scenario) throws Exception {
    var claims =
        new JWTClaimsSet.Builder()
            .issuer(
                scenario.equals("wrongIssuer")
                    ? "https://wrong.example.test"
                    : properties().issuer())
            .audience(scenario.equals("wrongAudience") ? "wrong" : properties().audience())
            .subject(
                scenario.equals("zeroSubject")
                    ? "0"
                    : scenario.equals("overflowSubject") ? "9999999999999999999" : "42");
    if (!scenario.equals("missingRole"))
      claims.claim("role", scenario.equals("badRole") ? "SUPER_ADMIN" : "CUSTOMER");
    if (!scenario.equals("missingIssuedAt"))
      claims.issueTime(Date.from(scenario.equals("futureIssuedAt") ? NOW.plusSeconds(60) : NOW));
    if (!scenario.equals("missingExpiry"))
      claims.expirationTime(
          Date.from(NOW.plusSeconds(scenario.equals("longLifetime") ? 3600 : 900)));
    var header =
        new JWSHeader.Builder(JWSAlgorithm.RS256)
            .type(new JOSEObjectType(scenario.equals("wrongType") ? "other+jwt" : "JWT"))
            .keyID(scenario.equals("wrongKid") ? "other-key" : properties().keyId())
            .build();
    var jwt = new SignedJWT(header, claims.build());
    jwt.sign(new RSASSASigner(KEYS.getPrivate()));
    unauthorized(jwt.serialize());
  }

  @Test
  void rejectsExpiredFutureAndTamperedTokens() {
    String raw = service(CLOCK).issue(user());
    assertThatThrownBy(() -> service(Clock.fixed(NOW.plusSeconds(931), ZoneOffset.UTC)).verify(raw))
        .isInstanceOf(BusinessException.class);
    unauthorized(raw.substring(0, raw.lastIndexOf('.') + 1) + "invalidSignature");
    unauthorized("not-a-jwt");
    unauthorized(null);
    unauthorized("A".repeat(8193));
  }

  @Test
  void loadsOnlyExplicitGeneratedKeyPairAndRejectsBadFiles(@TempDir Path directory)
      throws Exception {
    writeKeys(directory);
    var p =
        new SessionProperties(
            properties().issuer(),
            properties().audience(),
            properties().keyId(),
            directory.resolve("private.pem").toString(),
            directory.resolve("public.pem").toString(),
            properties().allowedOrigins(),
            properties().cookieName());
    var loaded = AccessTokenService.fromFiles(p, CLOCK);
    assertThat(loaded.verify(loaded.issue(user()))).isEqualTo(42);
    java.nio.file.Files.writeString(directory.resolve("private.pem"), "invalid-test-key");
    assertThatThrownBy(() -> AccessTokenService.fromFiles(p, CLOCK))
        .isInstanceOf(IllegalStateException.class)
        .hasMessage("JWT 키 파일 설정을 확인해 주세요.");
  }

  @Test
  void rejectsCorrectlyStructuredTokensSignedByAnotherKeyOrWithHmac() throws Exception {
    var claims =
        new JWTClaimsSet.Builder()
            .issuer(properties().issuer())
            .audience(properties().audience())
            .subject("42")
            .issueTime(Date.from(NOW))
            .expirationTime(Date.from(NOW.plusSeconds(900)))
            .claim("role", "CUSTOMER")
            .build();
    var rsa =
        new SignedJWT(
            new JWSHeader.Builder(JWSAlgorithm.RS256)
                .type(JOSEObjectType.JWT)
                .keyID(properties().keyId())
                .build(),
            claims);
    rsa.sign(new RSASSASigner(keys().getPrivate()));
    unauthorized(rsa.serialize());
    var hmac =
        new SignedJWT(
            new JWSHeader.Builder(JWSAlgorithm.HS256)
                .type(JOSEObjectType.JWT)
                .keyID(properties().keyId())
                .build(),
            claims);
    hmac.sign(new com.nimbusds.jose.crypto.MACSigner(KEYS.getPublic().getEncoded()));
    unauthorized(hmac.serialize());
  }

  private void unauthorized(String raw) {
    assertThatThrownBy(() -> service(CLOCK).verify(raw))
        .isInstanceOfSatisfying(
            BusinessException.class,
            e -> assertThat(e.errorCode()).isEqualTo(ErrorCode.UNAUTHORIZED));
  }
}
