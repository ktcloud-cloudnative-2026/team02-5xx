package com.peakorder.auth.service;

import com.peakorder.auth.config.RegistrationProperties;
import com.peakorder.auth.dto.CurrentUserResponse;
import com.peakorder.auth.dto.PasswordChangeRequest;
import com.peakorder.auth.dto.ProfileUpdateRequest;
import com.peakorder.auth.entity.User;
import com.peakorder.auth.entity.UserRole;
import com.peakorder.auth.entity.UserStatus;
import com.peakorder.auth.exception.BusinessException;
import com.peakorder.auth.exception.ErrorCode;
import com.peakorder.auth.repository.RefreshTokenRepository;
import com.peakorder.auth.repository.UserRepository;
import jakarta.validation.Validator;
import java.time.Clock;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

@Service
@ConditionalOnProperty(name = "auth.session.enabled", havingValue = "true")
public class AccountService {
  private final UserRepository users;
  private final RefreshTokenRepository refreshTokens;
  private final PasswordEncoder passwords;
  private final RegistrationProperties properties;
  private final Validator validator;
  private final TransactionTemplate transactions;
  private final AccessTokenService tokens;
  private final Clock clock;

  public AccountService(
      UserRepository users,
      RefreshTokenRepository refreshTokens,
      PasswordEncoder passwords,
      RegistrationProperties properties,
      Validator validator,
      TransactionTemplate transactions,
      AccessTokenService tokens,
      Clock clock) {
    this.users = users;
    this.refreshTokens = refreshTokens;
    this.passwords = passwords;
    this.properties = properties;
    this.validator = validator;
    this.transactions = transactions;
    this.tokens = tokens;
    this.clock = clock;
  }

  public CurrentUserResponse updateProfile(String accessToken, ProfileUpdateRequest request) {
    requireValid(request);
    long userId = tokens.verify(accessToken);
    return transactions.execute(
        status -> {
          User user = customerForUpdate(userId);
          user.changeNickname(request.nickname(), clock.instant());
          users.saveAndFlush(user);
          return CurrentUserResponse.from(user);
        });
  }

  public void changePassword(String accessToken, PasswordChangeRequest request) {
    requireValid(request);
    int length = request.newPassword().codePointCount(0, request.newPassword().length());
    if (length < properties.passwordMinLength() || length > properties.passwordMaxLength())
      throw new BusinessException(ErrorCode.INVALID_REQUEST);
    long userId = tokens.verify(accessToken);
    transactions.executeWithoutResult(
        status -> {
          // The same user lock is used by login/refresh/logout, so rotation cannot escape
          // revocation.
          User user = customerForUpdate(userId);
          if (!passwords.matches(request.currentPassword(), user.getPasswordHash()))
            throw new BusinessException(ErrorCode.CURRENT_PASSWORD_MISMATCH);
          user.changePasswordHash(passwords.encode(request.newPassword()), clock.instant());
          users.saveAndFlush(user);
          refreshTokens.revokeAllForUser(userId);
        });
  }

  private User customerForUpdate(long userId) {
    User user =
        users.lockById(userId).orElseThrow(() -> new BusinessException(ErrorCode.UNAUTHORIZED));
    if (user.getStatus() != UserStatus.ACTIVE) throw new BusinessException(ErrorCode.UNAUTHORIZED);
    if (user.getRole() != UserRole.CUSTOMER) throw new BusinessException(ErrorCode.FORBIDDEN);
    return user;
  }

  private void requireValid(Object request) {
    if (request == null || !validator.validate(request).isEmpty())
      throw new BusinessException(ErrorCode.INVALID_REQUEST);
  }
}
