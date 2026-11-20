package com.peakorder.auth.service;

import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.jwk.source.ImmutableJWKSet;
import com.peakorder.auth.config.SessionProperties;
import com.peakorder.auth.entity.User;
import com.peakorder.auth.entity.UserRole;
import com.peakorder.auth.exception.BusinessException;
import com.peakorder.auth.exception.ErrorCode;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyFactory;
import java.security.Signature;
import java.security.interfaces.RSAPrivateKey;
import java.security.interfaces.RSAPublicKey;
import java.security.spec.PKCS8EncodedKeySpec;
import java.security.spec.X509EncodedKeySpec;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.jose.jws.SignatureAlgorithm;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.JwtClaimValidator;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.security.oauth2.jwt.JwtException;
import org.springframework.security.oauth2.jwt.JwtIssuerValidator;
import org.springframework.security.oauth2.jwt.JwtTimestampValidator;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder;

public class AccessTokenService {
  public static final Duration ACCESS_TTL = Duration.ofMinutes(15);
  private final SessionProperties properties;
  private final Clock clock;
  private final RSAKey key;
  private final NimbusJwtEncoder encoder;
  private final NimbusJwtDecoder decoder;

  public AccessTokenService(
      SessionProperties properties, Clock clock, RSAPublicKey publicKey, RSAPrivateKey privateKey) {
    if (publicKey.getModulus().bitLength() < 2048
        || !publicKey.getModulus().equals(privateKey.getModulus())) {
      throw new IllegalArgumentException("JWT RSA 키 구성을 확인해 주세요.");
    }
    this.properties = properties;
    this.clock = clock;
    this.key =
        new RSAKey.Builder(publicKey).privateKey(privateKey).keyID(properties.keyId()).build();
    this.encoder = new NimbusJwtEncoder(new ImmutableJWKSet<>(new JWKSet(key)));
    this.decoder =
        NimbusJwtDecoder.withPublicKey(publicKey)
            .signatureAlgorithm(SignatureAlgorithm.RS256)
            .build();
    var timestamps = new JwtTimestampValidator(Duration.ofSeconds(30));
    timestamps.setClock(clock);
    decoder.setJwtValidator(
        new DelegatingOAuth2TokenValidator<>(
            timestamps,
            new JwtIssuerValidator(properties.issuer()),
            new JwtClaimValidator<List<String>>(
                "aud", values -> values != null && values.contains(properties.audience()))));
  }

  public static AccessTokenService fromFiles(SessionProperties properties, Clock clock) {
    try {
      var factory = KeyFactory.getInstance("RSA");
      var privateKey =
          (RSAPrivateKey)
              factory.generatePrivate(
                  new PKCS8EncodedKeySpec(readPem(properties.privateKeyFile(), "PRIVATE KEY")));
      var publicKey =
          (RSAPublicKey)
              factory.generatePublic(
                  new X509EncodedKeySpec(readPem(properties.publicKeyFile(), "PUBLIC KEY")));
      var signature = Signature.getInstance("SHA256withRSA");
      byte[] probe =
          "peakorder-key-pair-validation".getBytes(java.nio.charset.StandardCharsets.US_ASCII);
      signature.initSign(privateKey);
      signature.update(probe);
      byte[] signed = signature.sign();
      signature.initVerify(publicKey);
      signature.update(probe);
      if (!signature.verify(signed)) throw new IllegalArgumentException();
      return new AccessTokenService(properties, clock, publicKey, privateKey);
    } catch (Exception exception) {
      // Never include key contents or provider exception messages in startup logs.
      throw new IllegalStateException("JWT 키 파일 설정을 확인해 주세요.");
    }
  }

  private static byte[] readPem(String value, String label) throws Exception {
    Path file = Path.of(value);
    if (!Files.isRegularFile(file) || Files.size(file) > 16384)
      throw new IllegalArgumentException();
    String pem = Files.readString(file).strip();
    String begin = "-----BEGIN " + label + "-----";
    String end = "-----END " + label + "-----";
    if (!pem.startsWith(begin) || !pem.endsWith(end)) throw new IllegalArgumentException();
    return Base64.getDecoder()
        .decode(pem.substring(begin.length(), pem.length() - end.length()).replaceAll("\\s", ""));
  }

  public String issue(User user) {
    Instant now = clock.instant();
    var claims =
        JwtClaimsSet.builder()
            .issuer(properties.issuer())
            .audience(List.of(properties.audience()))
            .subject(user.getId().toString())
            .issuedAt(now)
            .expiresAt(now.plus(ACCESS_TTL))
            .claim("role", user.getRole().name())
            .build();
    return encoder
        .encode(
            JwtEncoderParameters.from(
                JwsHeader.with(SignatureAlgorithm.RS256)
                    .keyId(properties.keyId())
                    .type("JWT")
                    .build(),
                claims))
        .getTokenValue();
  }

  public long verify(String token) {
    try {
      if (token == null || token.length() > 8192) throw new IllegalArgumentException();
      var jwt = decoder.decode(token);
      Instant now = clock.instant();
      if (!properties.keyId().equals(jwt.getHeaders().get("kid"))
          || !"JWT".equals(jwt.getHeaders().get("typ"))
          || jwt.getSubject() == null
          || !jwt.getSubject().matches("[1-9][0-9]{0,18}")
          || jwt.getIssuedAt() == null
          || jwt.getExpiresAt() == null
          || jwt.getIssuedAt().isAfter(now.plusSeconds(30))
          || !jwt.getExpiresAt().isAfter(jwt.getIssuedAt())
          || Duration.between(jwt.getIssuedAt(), jwt.getExpiresAt()).compareTo(ACCESS_TTL) > 0) {
        throw new IllegalArgumentException();
      }
      UserRole.valueOf(jwt.getClaimAsString("role"));
      return Long.parseLong(jwt.getSubject());
    } catch (JwtException | IllegalArgumentException | NullPointerException exception) {
      throw new BusinessException(ErrorCode.UNAUTHORIZED);
    }
  }

  public Map<String, Object> publicKeys() {
    return new JWKSet(key.toPublicJWK()).toJSONObject();
  }
}
