package com.peakorder.auth;

import static com.peakorder.auth.AuthSessionTestSupport.*;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.peakorder.auth.config.RegistrationProperties;
import com.peakorder.auth.dto.PasswordChangeRequest;
import com.peakorder.auth.dto.ProfileUpdateRequest;
import com.peakorder.auth.entity.User;
import com.peakorder.auth.entity.UserRole;
import com.peakorder.auth.entity.UserStatus;
import com.peakorder.auth.exception.BusinessException;
import com.peakorder.auth.exception.ErrorCode;
import com.peakorder.auth.repository.RefreshTokenRepository;
import com.peakorder.auth.repository.UserRepository;
import com.peakorder.auth.service.AccessTokenService;
import com.peakorder.auth.service.AccountService;
import jakarta.validation.Validation;
import jakarta.validation.ValidatorFactory;
import java.util.Optional;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.SimpleTransactionStatus;
import org.springframework.transaction.support.TransactionTemplate;

class AccountServiceTests {
  private static final ValidatorFactory VALIDATION = Validation.buildDefaultValidatorFactory();
  private static final String ACCESS = "synthetic-access";
  private static final String OLD = "old local password";
  private static final String NEW = "new local password";
  private final UserRepository users = mock(UserRepository.class);
  private final RefreshTokenRepository refreshes = mock(RefreshTokenRepository.class);
  private final PasswordEncoder passwords = mock(PasswordEncoder.class);
  private final AccessTokenService tokens = mock(AccessTokenService.class);
  private final PlatformTransactionManager manager = mock(PlatformTransactionManager.class);
  private User user;
  private AccountService service;

  @BeforeEach
  void setup() {
    user = user();
    ReflectionTestUtils.setField(user, "updatedAt", NOW.minusSeconds(60));
    when(tokens.verify(ACCESS)).thenReturn(42L);
    when(users.lockById(42L)).thenReturn(Optional.of(user));
    when(manager.getTransaction(any())).thenReturn(new SimpleTransactionStatus());
    when(passwords.matches(OLD, "stored-password-hash")).thenReturn(true);
    when(passwords.encode(NEW)).thenReturn("new-password-hash");
    service =
        new AccountService(
            users,
            refreshes,
            passwords,
            new RegistrationProperties(12, 64, "local-test-v1", "local-test-v1"),
            VALIDATION.getValidator(),
            new TransactionTemplate(manager),
            tokens,
            CLOCK);
  }

  @AfterAll
  static void closeValidation() {
    VALIDATION.close();
  }

  @Test
  void nicknameUpdatePreservesWhitespaceIdentityAndSession() {
    var result = service.updateProfile(ACCESS, new ProfileUpdateRequest("  닉네임  "));
    assertThat(result.id()).isEqualTo(42L);
    assertThat(result.email()).isEqualTo(user.getEmail());
    assertThat(result.role()).isEqualTo(UserRole.CUSTOMER);
    assertThat(result.nickname()).isEqualTo("  닉네임  ");
    assertThat(user.getPasswordHash()).isEqualTo("stored-password-hash");
    assertThat(ReflectionTestUtils.getField(user, "updatedAt")).isEqualTo(NOW);
    verify(users).saveAndFlush(user);
    verifyNoInteractions(passwords, refreshes);
  }

  @Test
  void nicknameCountsCodePointsRatherThanUtf16Units() {
    String fifty = "😀".repeat(50);
    assertThat(service.updateProfile(ACCESS, new ProfileUpdateRequest(fifty)).nickname())
        .isEqualTo(fifty);
    failure(
        ErrorCode.INVALID_REQUEST,
        () -> service.updateProfile(ACCESS, new ProfileUpdateRequest(fifty + "a")));
  }

  @Test
  void nicknameCannotBeClearedOrBlank() {
    for (String value : new String[] {null, "", "  ", "\t\n", "a".repeat(51)}) {
      failure(
          ErrorCode.INVALID_REQUEST,
          () -> service.updateProfile(ACCESS, new ProfileUpdateRequest(value)));
    }
    failure(ErrorCode.INVALID_REQUEST, () -> service.updateProfile(ACCESS, null));
    verifyNoInteractions(users, refreshes, passwords, tokens);
  }

  @Test
  void invalidAccessCannotTouchAccount() {
    when(tokens.verify(ACCESS)).thenThrow(new BusinessException(ErrorCode.UNAUTHORIZED));
    failure(
        ErrorCode.UNAUTHORIZED,
        () -> service.updateProfile(ACCESS, new ProfileUpdateRequest("member")));
    failure(
        ErrorCode.UNAUTHORIZED,
        () -> service.changePassword(ACCESS, new PasswordChangeRequest(OLD, NEW)));
    verifyNoInteractions(users, refreshes, passwords);
  }

  @Test
  void missingInactiveAndAdminAccountsCannotBeChanged() {
    when(users.lockById(42L)).thenReturn(Optional.empty());
    rejectBoth(ErrorCode.UNAUTHORIZED);
    when(users.lockById(42L)).thenReturn(Optional.of(user));
    for (UserStatus status : new UserStatus[] {UserStatus.SUSPENDED, UserStatus.WITHDRAWN}) {
      ReflectionTestUtils.setField(user, "status", status);
      rejectBoth(ErrorCode.UNAUTHORIZED);
    }
    ReflectionTestUtils.setField(user, "status", UserStatus.ACTIVE);
    ReflectionTestUtils.setField(user, "role", UserRole.STORE_ADMIN);
    rejectBoth(ErrorCode.FORBIDDEN);
    verify(users, never()).saveAndFlush(any());
    verifyNoInteractions(passwords, refreshes);
  }

  @Test
  void passwordChangeUsesUserLockAndRevokesOnlyOwnersSessions() {
    service.changePassword(ACCESS, new PasswordChangeRequest(OLD, NEW));
    assertThat(user.getPasswordHash()).isEqualTo("new-password-hash");
    assertThat(ReflectionTestUtils.getField(user, "updatedAt")).isEqualTo(NOW);
    var order = inOrder(users, passwords, refreshes, manager);
    order.verify(users).lockById(42L);
    order.verify(passwords).matches(OLD, "stored-password-hash");
    order.verify(passwords).encode(NEW);
    order.verify(users).saveAndFlush(user);
    order.verify(refreshes).revokeAllForUser(42L);
    order.verify(manager).commit(any());
  }

  @Test
  void wrongCurrentPasswordDoesNotEncodeUpdateOrRevoke() {
    failure(
        ErrorCode.CURRENT_PASSWORD_MISMATCH,
        () -> service.changePassword(ACCESS, new PasswordChangeRequest("wrong password", NEW)));
    assertThat(user.getPasswordHash()).isEqualTo("stored-password-hash");
    verify(passwords, never()).encode(anyString());
    verify(users, never()).saveAndFlush(any());
    verifyNoInteractions(refreshes);
    verify(manager).rollback(any());
  }

  @Test
  void newPasswordReusesConfiguredLengthAndRejectsMissingInput() {
    for (String value : new String[] {null, "", " ".repeat(12), "a".repeat(11), "a".repeat(65)}) {
      failure(
          ErrorCode.INVALID_REQUEST,
          () -> service.changePassword(ACCESS, new PasswordChangeRequest(OLD, value)));
    }
    failure(ErrorCode.INVALID_REQUEST, () -> service.changePassword(ACCESS, null));
    failure(
        ErrorCode.INVALID_REQUEST,
        () -> service.changePassword(ACCESS, new PasswordChangeRequest(null, NEW)));
    verifyNoInteractions(users, passwords, refreshes, tokens);
  }

  @Test
  void passwordCharactersAreNotTrimmed() {
    String current = " current password ";
    String next = " new local password ";
    when(passwords.matches(current, "stored-password-hash")).thenReturn(true);
    when(passwords.encode(next)).thenReturn("space-preserving-hash");
    service.changePassword(ACCESS, new PasswordChangeRequest(current, next));
    verify(passwords).matches(current, "stored-password-hash");
    verify(passwords).encode(next);
  }

  @Test
  void sessionRevocationFailureRollsBackTransaction() {
    doThrow(new DataIntegrityViolationException("synthetic revocation failure"))
        .when(refreshes)
        .revokeAllForUser(42L);
    assertThatThrownBy(() -> service.changePassword(ACCESS, new PasswordChangeRequest(OLD, NEW)))
        .isInstanceOf(DataIntegrityViolationException.class);
    verify(manager).rollback(any());
    verify(manager, never()).commit(any());
  }

  @Test
  void sensitiveRequestToStringIsRedacted() {
    assertThat(new PasswordChangeRequest(OLD, NEW).toString()).doesNotContain(OLD, NEW);
    assertThat(new ProfileUpdateRequest("personal nickname").toString())
        .doesNotContain("personal nickname");
  }

  private void rejectBoth(ErrorCode code) {
    failure(code, () -> service.updateProfile(ACCESS, new ProfileUpdateRequest("member")));
    failure(code, () -> service.changePassword(ACCESS, new PasswordChangeRequest(OLD, NEW)));
  }

  private static void failure(
      ErrorCode code, org.assertj.core.api.ThrowableAssert.ThrowingCallable f) {
    assertThatThrownBy(f)
        .isInstanceOfSatisfying(
            BusinessException.class, e -> assertThat(e.errorCode()).isEqualTo(code));
  }
}
