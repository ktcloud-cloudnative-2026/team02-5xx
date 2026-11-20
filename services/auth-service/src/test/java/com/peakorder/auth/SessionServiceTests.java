package com.peakorder.auth;

import static com.peakorder.auth.AuthSessionTestSupport.*;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.peakorder.auth.dto.LoginRequest;
import com.peakorder.auth.entity.RefreshToken;
import com.peakorder.auth.entity.User;
import com.peakorder.auth.entity.UserStatus;
import com.peakorder.auth.exception.BusinessException;
import com.peakorder.auth.exception.ErrorCode;
import com.peakorder.auth.repository.RefreshTokenRepository;
import com.peakorder.auth.repository.UserRepository;
import com.peakorder.auth.service.AccessTokenService;
import com.peakorder.auth.service.SessionService;
import jakarta.validation.Validation;
import java.time.Duration;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.SimpleTransactionStatus;
import org.springframework.transaction.support.TransactionTemplate;

class SessionServiceTests {
  private final UserRepository users = mock(UserRepository.class);
  private final RefreshTokenRepository refreshes = mock(RefreshTokenRepository.class);
  private final PasswordEncoder passwords = mock(PasswordEncoder.class);
  private final AccessTokenService tokens = mock(AccessTokenService.class);
  private final PlatformTransactionManager manager = mock(PlatformTransactionManager.class);
  private SessionService service;
  private User user;
  private final UUID session = UUID.randomUUID();

  @BeforeEach
  void setup() {
    user = user();
    when(passwords.encode(anyString())).thenReturn("dummy-hash");
    when(manager.getTransaction(any())).thenReturn(new SimpleTransactionStatus());
    when(users.findByEmail(anyString())).thenReturn(Optional.of(user));
    when(users.lockById(42L)).thenReturn(Optional.of(user));
    when(tokens.issue(user)).thenReturn("synthetic-access-token");
    service =
        new SessionService(
            users,
            refreshes,
            passwords,
            Validation.buildDefaultValidatorFactory().getValidator(),
            new TransactionTemplate(manager),
            tokens,
            CLOCK);
  }

  @Test
  void loginPreservesEmailRulesAndAbsoluteRememberMeExpiryWithoutExposingRefresh() {
    when(passwords.matches("valid password", "stored-password-hash")).thenReturn(true);
    var result = service.login(new LoginRequest(" Member@EXAMPLE.TEST ", "valid password", true));
    verify(users).findByEmail("Member@example.test");
    assertThat(result.expiresAt()).isEqualTo(NOW.plus(Duration.ofDays(14)));
    assertThat(result.refreshToken()).matches("[A-Za-z0-9_-]{43}");
    assertThat(result.response().expiresIn()).isEqualTo(900);
    assertThat(result.response().user().role().name()).isEqualTo("CUSTOMER");
    assertThat(result.toString()).doesNotContain(result.refreshToken(), "valid password");
    var saved = org.mockito.ArgumentCaptor.forClass(RefreshToken.class);
    verify(refreshes).saveAndFlush(saved.capture());
    assertThat(ReflectionTestUtils.getField(saved.getValue(), "tokenHash"))
        .isEqualTo(SessionService.tokenHash(result.refreshToken()))
        .isNotEqualTo(result.refreshToken());
  }

  @Test
  void loginNormalizesMaximumLengthEmailBeforeCheckingLength() {
    String email =
        "a".repeat(64) + "@" + "b".repeat(63) + "." + "c".repeat(63) + "." + "d".repeat(61);
    assertThat(email).hasSize(254);
    when(passwords.matches(anyString(), anyString())).thenReturn(true);
    service.login(new LoginRequest(" " + email + " ", "valid", false));
    verify(users).findByEmail(email);
  }

  @Test
  void loginRejectsOverlongNormalizedEmailAndRawInputBeforeAccountLookup() {
    String email =
        "a".repeat(64) + "@" + "b".repeat(63) + "." + "c".repeat(63) + "." + "d".repeat(62);
    assertThat(email).hasSize(255);
    for (String input :
        java.util.List.of(" " + email + " ", " ".repeat(1025) + "member@example.test")) {
      assertThatThrownBy(() -> service.login(new LoginRequest(input, "valid", false)))
          .isInstanceOfSatisfying(
              BusinessException.class,
              e -> assertThat(e.errorCode()).isEqualTo(ErrorCode.INVALID_REQUEST));
    }
    verifyNoInteractions(users, refreshes, tokens);
  }

  @Test
  void defaultLoginHasOneDayLifetime() {
    when(passwords.matches(anyString(), anyString())).thenReturn(true);
    var result = service.login(new LoginRequest(user.getEmail(), "valid password", null));
    assertThat(result.rememberMe()).isFalse();
    assertThat(result.expiresAt()).isEqualTo(NOW.plus(Duration.ofDays(1)));
  }

  @Test
  void unknownAccountAndWrongPasswordReturnSameErrorAndNoTokens() {
    when(users.findByEmail(anyString())).thenReturn(Optional.empty());
    unauthorized(() -> service.login(new LoginRequest("unknown@example.test", "wrong", false)));
    verify(passwords).matches("wrong", "dummy-hash");
    when(users.findByEmail(anyString())).thenReturn(Optional.of(user));
    unauthorized(() -> service.login(new LoginRequest(user.getEmail(), "wrong", false)));
    verifyNoInteractions(tokens, refreshes);
  }

  @Test
  void statusOrPasswordChangeBetweenLookupAndLockPreventsLogin() {
    when(passwords.matches(anyString(), anyString())).thenReturn(true);
    var changed = user();
    ReflectionTestUtils.setField(changed, "passwordHash", "new-hash");
    when(users.lockById(42L)).thenReturn(Optional.of(changed));
    unauthorized(() -> service.login(new LoginRequest(user.getEmail(), "valid", false)));
    verifyNoInteractions(tokens, refreshes);
  }

  @Test
  void meVerifiesTokenAndCurrentAccountStatus() {
    when(tokens.verify("synthetic-access-token")).thenReturn(42L);
    when(users.findById(42L)).thenReturn(Optional.of(user));
    assertThat(service.currentUser("synthetic-access-token").nickname()).isNull();
    ReflectionTestUtils.setField(user, "status", UserStatus.SUSPENDED);
    unauthorized(() -> service.currentUser("synthetic-access-token"));
  }

  @Test
  void refreshRevokesBeforeInsertAndNeverExtendsOriginalSessionExpiry() {
    var old = oldToken();
    when(refreshes.findOwner(anyString())).thenReturn(Optional.of(42L));
    when(refreshes.findByTokenHash(anyString())).thenReturn(Optional.of(old));
    var result = service.refresh(RAW);
    assertThat(result.expiresAt()).isEqualTo(NOW.plusSeconds(3600));
    var order = inOrder(users, refreshes);
    order.verify(refreshes).findOwner(anyString());
    order.verify(users).lockById(42L);
    order.verify(refreshes).findByTokenHash(anyString());
    order.verify(refreshes).revokeSession(42L, session);
    order.verify(refreshes).saveAndFlush(any());
  }

  @Test
  void replayRevocationCommitsBeforeUnauthorizedIsThrown() {
    var old = oldToken();
    ReflectionTestUtils.setField(old, "revoked", true);
    when(refreshes.findOwner(anyString())).thenReturn(Optional.of(42L));
    when(refreshes.findByTokenHash(anyString())).thenReturn(Optional.of(old));
    unauthorized(() -> service.refresh(RAW));
    verify(refreshes).revokeSession(42L, session);
    verify(manager).commit(any());
    verify(manager, never()).rollback(any());
    verify(refreshes, never()).saveAndFlush(any());
  }

  @Test
  void expiredOrInactiveSessionCannotMintTokens() {
    var old = oldToken();
    ReflectionTestUtils.setField(old, "expiresAt", NOW);
    when(refreshes.findOwner(anyString())).thenReturn(Optional.of(42L));
    when(refreshes.findByTokenHash(anyString())).thenReturn(Optional.of(old));
    unauthorized(() -> service.refresh(RAW));
    verify(refreshes, never()).saveAndFlush(any());
  }

  @Test
  void malformedRefreshNeverQueriesDatabaseAndLogoutIsIdempotent() {
    unauthorized(() -> service.refresh("malformed"));
    service.logout(null);
    service.logout("malformed");
    verifyNoInteractions(users, refreshes);
  }

  @Test
  void logoutRevokesOnlyTheSessionIdentifiedByCookie() {
    when(refreshes.findOwner(anyString())).thenReturn(Optional.of(42L));
    when(refreshes.findByTokenHash(anyString())).thenReturn(Optional.of(oldToken()));
    service.logout(RAW);
    verify(users).lockById(42L);
    verify(refreshes).revokeSession(42L, session);
    verify(refreshes, never()).saveAndFlush(any());
  }

  private RefreshToken oldToken() {
    return new RefreshToken(
        42L,
        session,
        SessionService.tokenHash(RAW),
        NOW.plusSeconds(3600),
        false,
        NOW.minusSeconds(600));
  }

  private void unauthorized(Runnable call) {
    assertThatThrownBy(call::run)
        .isInstanceOfSatisfying(
            BusinessException.class,
            e -> assertThat(e.errorCode()).isEqualTo(ErrorCode.UNAUTHORIZED));
  }
}
