package com.peakorder.auth;

import com.peakorder.auth.config.SessionProperties;
import com.peakorder.auth.entity.User;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Base64;
import java.util.List;
import org.springframework.test.util.ReflectionTestUtils;

final class AuthSessionTestSupport {
  static final Instant NOW = Instant.parse("2026-11-20T00:00:00Z");
  static final Clock CLOCK = Clock.fixed(NOW, ZoneOffset.UTC);
  static final String ORIGIN = "https://web.example.test";
  static final String RAW = "A".repeat(43);
  static final KeyPair KEYS = keys();

  static SessionProperties properties() {
    return new SessionProperties(
        "https://issuer.example.test",
        "peakorder",
        "local-test-key",
        "unused-private",
        "unused-public",
        List.of(ORIGIN),
        "peakorderRefreshToken");
  }

  static User user() {
    User user = new User("Member@example.test", "stored-password-hash", NOW);
    ReflectionTestUtils.setField(user, "id", 42L);
    return user;
  }

  static KeyPair keys() {
    try {
      var generator = KeyPairGenerator.getInstance("RSA");
      generator.initialize(2048);
      return generator.generateKeyPair();
    } catch (Exception exception) {
      throw new IllegalStateException(exception);
    }
  }

  static void writeKeys(Path directory) throws Exception {
    pem(directory.resolve("private.pem"), "PRIVATE KEY", KEYS.getPrivate().getEncoded());
    pem(directory.resolve("public.pem"), "PUBLIC KEY", KEYS.getPublic().getEncoded());
  }

  private static void pem(Path file, String label, byte[] bytes) throws Exception {
    Files.writeString(
        file,
        "-----BEGIN "
            + label
            + "-----\n"
            + Base64.getMimeEncoder(64, new byte[] {'\n'}).encodeToString(bytes)
            + "\n-----END "
            + label
            + "-----\n");
  }
}
