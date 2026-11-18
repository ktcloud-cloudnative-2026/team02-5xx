package com.peakorder.auth.service;

import com.peakorder.auth.config.RegistrationProperties;
import com.peakorder.auth.dto.AgreementRequest;
import com.peakorder.auth.dto.EmailAvailabilityResponse;
import com.peakorder.auth.dto.RegistrationRequest;
import com.peakorder.auth.dto.RegistrationResponse;
import com.peakorder.auth.entity.AgreementType;
import com.peakorder.auth.entity.User;
import com.peakorder.auth.entity.UserAgreement;
import com.peakorder.auth.exception.BusinessException;
import com.peakorder.auth.exception.ErrorCode;
import com.peakorder.auth.repository.UserAgreementRepository;
import com.peakorder.auth.repository.UserRepository;
import jakarta.validation.Validator;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.EnumSet;
import java.util.Locale;
import org.hibernate.exception.ConstraintViolationException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

@Service
public class RegistrationService {
  private final UserRepository users;
  private final UserAgreementRepository agreements;
  private final PasswordEncoder passwords;
  private final RegistrationProperties properties;
  private final Validator validator;
  private final TransactionTemplate transactions;

  public RegistrationService(
      UserRepository users,
      UserAgreementRepository agreements,
      PasswordEncoder passwords,
      RegistrationProperties properties,
      Validator validator,
      TransactionTemplate transactions) {
    this.users = users;
    this.agreements = agreements;
    this.passwords = passwords;
    this.properties = properties;
    this.validator = validator;
    this.transactions = transactions;
  }

  public EmailAvailabilityResponse checkEmail(String email) {
    String normalized = normalizeEmail(email);
    return new EmailAvailabilityResponse(normalized, !users.existsByEmail(normalized));
  }

  public RegistrationResponse register(RegistrationRequest request) {
    if (request == null || !validator.validate(request).isEmpty()) {
      throw new BusinessException(ErrorCode.INVALID_REQUEST);
    }
    String email = normalizeEmail(request.email());
    int length = request.password().codePointCount(0, request.password().length());
    if (length < properties.passwordMinLength() || length > properties.passwordMaxLength()) {
      throw new BusinessException(ErrorCode.INVALID_REQUEST);
    }
    validateAgreements(request);
    if (users.existsByEmail(email)) {
      throw new BusinessException(ErrorCode.EMAIL_ALREADY_EXISTS);
    }

    String hash = passwords.encode(request.password());
    try {
      return transactions.execute(
          status -> {
            Instant now = Instant.now();
            User user = users.saveAndFlush(new User(email, hash, now));
            var consent =
                request.agreements().stream()
                    .map(item -> new UserAgreement(user, item.type(), item.version(), now))
                    .toList();
            agreements.saveAllAndFlush(consent);
            return new RegistrationResponse(user.getId(), user.getEmail());
          });
    } catch (DataIntegrityViolationException exception) {
      for (Throwable cause = exception; cause != null; cause = cause.getCause()) {
        if (cause instanceof ConstraintViolationException violation
            && "uk_users_email".equals(violation.getConstraintName())) {
          throw new BusinessException(ErrorCode.EMAIL_ALREADY_EXISTS);
        }
      }
      throw exception;
    }
  }

  private String normalizeEmail(String value) {
    if (value == null) {
      throw new BusinessException(ErrorCode.INVALID_REQUEST);
    }
    String email = value.strip();
    if (!validator.validate(new EmailInput(email)).isEmpty()) {
      throw new BusinessException(ErrorCode.INVALID_REQUEST);
    }
    int separator = email.lastIndexOf('@');
    return email.substring(0, separator + 1)
        + email.substring(separator + 1).toLowerCase(Locale.ROOT);
  }

  private void validateAgreements(RegistrationRequest request) {
    if (properties.termsVersion().isBlank() || properties.privacyVersion().isBlank()) {
      throw new BusinessException(ErrorCode.REGISTRATION_UNAVAILABLE);
    }
    var seen = EnumSet.noneOf(AgreementType.class);
    for (AgreementRequest item : request.agreements()) {
      if (!seen.add(item.type())) {
        throw new BusinessException(ErrorCode.INVALID_REQUEST);
      }
      String expected =
          item.type() == AgreementType.TERMS
              ? properties.termsVersion()
              : properties.privacyVersion();
      if (!expected.equals(item.version())) {
        throw new BusinessException(ErrorCode.INVALID_AGREEMENT_VERSION);
      }
      if (!Boolean.TRUE.equals(item.agreed())) {
        throw new BusinessException(ErrorCode.REQUIRED_AGREEMENT_MISSING);
      }
    }
    if (seen.size() != AgreementType.values().length) {
      throw new BusinessException(ErrorCode.REQUIRED_AGREEMENT_MISSING);
    }
  }

  private record EmailInput(@NotBlank @Email @Size(max = 254) String value) {}
}
