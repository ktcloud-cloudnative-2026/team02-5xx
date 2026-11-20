package com.peakorder.auth.service;

import com.peakorder.auth.dto.CurrentUserResponse;
import com.peakorder.auth.dto.LoginRequest;
import com.peakorder.auth.dto.SessionResponse;
import com.peakorder.auth.dto.SessionResponse.SessionUser;
import com.peakorder.auth.entity.RefreshToken;
import com.peakorder.auth.entity.User;
import com.peakorder.auth.entity.UserStatus;
import com.peakorder.auth.exception.BusinessException;
import com.peakorder.auth.exception.ErrorCode;
import com.peakorder.auth.repository.RefreshTokenRepository;
import com.peakorder.auth.repository.UserRepository;
import jakarta.validation.Validator;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.Map;
import java.util.UUID;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

@Service
@ConditionalOnProperty(name = "auth.session.enabled", havingValue = "true")
public class SessionService {
  private final UserRepository users;
  private final RefreshTokenRepository refreshTokens;
  private final PasswordEncoder passwords;
  private final Validator validator;
  private final TransactionTemplate transactions;
  private final AccessTokenService tokens;
  private final Clock clock;
  private final SecureRandom random = new SecureRandom();
  private final String dummyHash;

  public SessionService(
      UserRepository users,
      RefreshTokenRepository refreshTokens,
      PasswordEncoder passwords,
      Validator validator,
      TransactionTemplate transactions,
      AccessTokenService tokens,
      Clock clock) {
    this.users = users;
    this.refreshTokens = refreshTokens;
    this.passwords = passwords;
    this.validator = validator;
    this.transactions = transactions;
    this.tokens = tokens;
    this.clock = clock;
    this.dummyHash = passwords.encode("synthetic unavailable account");
  }

  public SessionResult login(LoginRequest request) {
    if (request == null || !validator.validate(request).isEmpty())
      throw new BusinessException(ErrorCode.INVALID_REQUEST);
    String email = EmailAddress.normalize(request.email(), validator);
    User candidate = users.findByEmail(email).orElse(null);
    boolean matches =
        passwords.matches(
            request.password(), candidate == null ? dummyHash : candidate.getPasswordHash());
    if (candidate == null || !matches || candidate.getStatus() != UserStatus.ACTIVE)
      throw unauthorized();
    return transactions.execute(
        status -> {
          User current =
              users.lockById(candidate.getId()).orElseThrow(SessionService::unauthorized);
          if (current.getStatus() != UserStatus.ACTIVE
              || !current.getPasswordHash().equals(candidate.getPasswordHash()))
            throw unauthorized();
          boolean rememberMe = Boolean.TRUE.equals(request.rememberMe());
          Instant now = clock.instant();
          return create(
              current,
              UUID.randomUUID(),
              rememberMe,
              now.plus(rememberMe ? Duration.ofDays(14) : Duration.ofDays(1)),
              now);
        });
  }

  public CurrentUserResponse currentUser(String accessToken) {
    long userId = tokens.verify(accessToken);
    User user = users.findById(userId).orElseThrow(SessionService::unauthorized);
    if (user.getStatus() != UserStatus.ACTIVE) throw unauthorized();
    return CurrentUserResponse.from(user);
  }

  public SessionResult refresh(String rawToken) {
    String hash = tokenHash(rawToken);
    SessionResult result =
        transactions.execute(
            status -> {
              // Scalar lookup avoids retaining an entity snapshot before acquiring the user lock.
              Long owner = refreshTokens.findOwner(hash).orElse(null);
              if (owner == null) return null;
              User user = users.lockById(owner).orElse(null);
              RefreshToken old = refreshTokens.findByTokenHash(hash).orElse(null);
              if (user == null || old == null) return null;
              if (old.isRevoked() || user.getStatus() != UserStatus.ACTIVE) {
                refreshTokens.revokeSession(owner, old.getSessionId());
                return null;
              }
              Instant now = clock.instant();
              if (!old.getExpiresAt().isAfter(now)) {
                refreshTokens.revokeSession(owner, old.getSessionId());
                return null;
              }
              // Execute revocation before inserting; a DB unique index also enforces one active
              // token.
              refreshTokens.revokeSession(owner, old.getSessionId());
              return create(user, old.getSessionId(), old.isRememberMe(), old.getExpiresAt(), now);
            });
    // Revocation must COMMIT before returning 401; throwing inside the transaction would undo it.
    if (result == null) throw unauthorized();
    return result;
  }

  public void logout(String rawToken) {
    if (rawToken == null) return;
    String hash;
    try {
      hash = tokenHash(rawToken);
    } catch (BusinessException invalid) {
      return;
    }
    transactions.executeWithoutResult(
        status -> {
          Long owner = refreshTokens.findOwner(hash).orElse(null);
          if (owner == null || users.lockById(owner).isEmpty()) return;
          refreshTokens
              .findByTokenHash(hash)
              .ifPresent(token -> refreshTokens.revokeSession(owner, token.getSessionId()));
        });
  }

  public Map<String, Object> publicKeys() {
    return tokens.publicKeys();
  }

  private SessionResult create(
      User user, UUID sessionId, boolean rememberMe, Instant expiresAt, Instant now) {
    byte[] secret = new byte[32];
    random.nextBytes(secret);
    String raw = Base64.getUrlEncoder().withoutPadding().encodeToString(secret);
    refreshTokens.saveAndFlush(
        new RefreshToken(user.getId(), sessionId, tokenHash(raw), expiresAt, rememberMe, now));
    return new SessionResult(
        new SessionResponse(
            tokens.issue(user),
            "Bearer",
            AccessTokenService.ACCESS_TTL.toSeconds(),
            SessionUser.from(user)),
        raw,
        rememberMe,
        expiresAt);
  }

  public static String tokenHash(String raw) {
    if (raw == null || !raw.matches("[A-Za-z0-9_-]{43}")) throw unauthorized();
    try {
      return HexFormat.of()
          .formatHex(
              MessageDigest.getInstance("SHA-256").digest(raw.getBytes(StandardCharsets.US_ASCII)));
    } catch (NoSuchAlgorithmException impossible) {
      throw new IllegalStateException("SHA-256 is unavailable");
    }
  }

  private static BusinessException unauthorized() {
    return new BusinessException(ErrorCode.UNAUTHORIZED);
  }

  public record SessionResult(
      SessionResponse response, String refreshToken, boolean rememberMe, Instant expiresAt) {
    @Override
    public String toString() {
      return "SessionResult[redacted]";
    }
  }
}
