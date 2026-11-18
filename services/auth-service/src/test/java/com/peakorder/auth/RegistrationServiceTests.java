package com.peakorder.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.peakorder.auth.config.RegistrationProperties;
import com.peakorder.auth.dto.AgreementRequest;
import com.peakorder.auth.dto.RegistrationRequest;
import com.peakorder.auth.entity.AgreementType;
import com.peakorder.auth.exception.BusinessException;
import com.peakorder.auth.exception.ErrorCode;
import com.peakorder.auth.repository.UserAgreementRepository;
import com.peakorder.auth.repository.UserRepository;
import com.peakorder.auth.service.RegistrationService;
import jakarta.validation.Validation;
import jakarta.validation.ValidatorFactory;
import java.sql.SQLException;
import java.util.List;
import org.hibernate.exception.ConstraintViolationException;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullAndEmptySource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.transaction.TransactionStatus;
import org.springframework.transaction.support.TransactionCallback;
import org.springframework.transaction.support.TransactionTemplate;

class RegistrationServiceTests {
  private static ValidatorFactory validators;
  private UserRepository users;
  private UserAgreementRepository agreements;
  private PasswordEncoder passwords;
  private TransactionTemplate transactions;
  private RegistrationService service;

  @BeforeAll
  static void initializeValidation() {
    validators = Validation.buildDefaultValidatorFactory();
  }

  @AfterAll
  static void closeValidation() {
    validators.close();
  }

  @BeforeEach
  void setUp() {
    users = mock(UserRepository.class);
    agreements = mock(UserAgreementRepository.class);
    passwords = mock(PasswordEncoder.class);
    transactions = mock(TransactionTemplate.class);
    service = createService(new RegistrationProperties(12, 64, "local-test-v1", "local-test-v1"));
  }

  @ParameterizedTest
  @ValueSource(strings = {" Member@EXAMPLE.TEST ", "Member@example.test", "Member@Example.Test"})
  void normalizesEmailConsistently(String email) {
    var result = service.checkEmail(email);
    assertThat(result.email()).isEqualTo("Member@example.test");
    assertThat(result.available()).isTrue();
    verify(users).existsByEmail("Member@example.test");
  }

  @ParameterizedTest
  @NullAndEmptySource
  @ValueSource(strings = {" ", "invalid", "a@", "@example.test", "a b@example.test"})
  void rejectsInvalidEmail(String email) {
    assertThatThrownBy(() -> service.checkEmail(email))
        .isInstanceOf(BusinessException.class)
        .hasMessage(ErrorCode.INVALID_REQUEST.message());
    verifyNoInteractions(users);
  }

  @Test
  void existingEmailIsUnavailable() {
    when(users.existsByEmail("member@example.test")).thenReturn(true);
    assertThat(service.checkEmail("member@example.test").available()).isFalse();
  }

  @ParameterizedTest
  @ValueSource(ints = {0, 1, 11, 65})
  void rejectsPasswordOutsideConfiguredRange(int length) {
    assertBusiness(request("a".repeat(length), validAgreements()), ErrorCode.INVALID_REQUEST);
    verifyNoInteractions(passwords, transactions);
  }

  @ParameterizedTest
  @ValueSource(ints = {12, 64})
  void acceptsPasswordBoundary(int length) {
    allowPersistence();
    service.register(request("a".repeat(length), validAgreements()));
    verify(passwords).encode("a".repeat(length));
  }

  @Test
  void countsUnicodeCodePointsAndPreservesSpaces() {
    allowPersistence();
    String password = " " + "😀".repeat(62) + " ";
    service.register(request(password, validAgreements()));
    verify(passwords).encode(password);
  }

  @Test
  void rejectsNullPassword() {
    assertBusiness(request(null, validAgreements()), ErrorCode.INVALID_REQUEST);
  }

  @Test
  void rejectsMissingAgreement() {
    assertBusiness(
        request("valid password", List.of(validAgreements().getFirst())),
        ErrorCode.REQUIRED_AGREEMENT_MISSING);
  }

  @Test
  void rejectsDuplicateAgreementType() {
    assertBusiness(
        request(
            "valid password", List.of(validAgreements().getFirst(), validAgreements().getFirst())),
        ErrorCode.INVALID_REQUEST);
  }

  @Test
  void rejectsOutdatedAgreementVersion() {
    assertBusiness(
        request(
            "valid password",
            List.of(
                new AgreementRequest(AgreementType.TERMS, "outdated", true),
                validAgreements().getLast())),
        ErrorCode.INVALID_AGREEMENT_VERSION);
  }

  @Test
  void rejectsDeclinedAgreement() {
    assertBusiness(
        request(
            "valid password",
            List.of(
                new AgreementRequest(AgreementType.TERMS, "local-test-v1", false),
                validAgreements().getLast())),
        ErrorCode.REQUIRED_AGREEMENT_MISSING);
  }

  @Test
  void rejectsNullAgreementItem() {
    assertBusiness(
        request("valid password", java.util.Arrays.asList(null, validAgreements().getLast())),
        ErrorCode.INVALID_REQUEST);
  }

  @Test
  void requiresConfiguredRealAgreementVersions() {
    service = createService(new RegistrationProperties(12, 64, "", ""));
    assertBusiness(
        request("valid password", validAgreements()), ErrorCode.REGISTRATION_UNAVAILABLE);
    verifyNoInteractions(users, passwords);
  }

  @Test
  void rejectsKnownDuplicateBeforeHashing() {
    when(users.existsByEmail("member@example.test")).thenReturn(true);
    assertBusiness(request("valid password", validAgreements()), ErrorCode.EMAIL_ALREADY_EXISTS);
    verifyNoInteractions(passwords, transactions);
  }

  @Test
  void translatesOnlyNamedEmailUniqueConstraint() {
    allowPersistence();
    var cause =
        new ConstraintViolationException(
            "duplicate", new SQLException("duplicate", "23505"), "uk_users_email");
    when(users.saveAndFlush(any()))
        .thenThrow(new DataIntegrityViolationException("insert failed", cause));
    assertBusiness(request("valid password", validAgreements()), ErrorCode.EMAIL_ALREADY_EXISTS);
  }

  @Test
  void preservesOtherDatabaseFailures() {
    allowPersistence();
    var cause =
        new ConstraintViolationException(
            "constraint", new SQLException("constraint", "23505"), "another_constraint");
    var failure = new DataIntegrityViolationException("insert failed", cause);
    when(users.saveAndFlush(any())).thenThrow(failure);
    assertThatThrownBy(() -> service.register(request("valid password", validAgreements())))
        .isSameAs(failure);
  }

  @Test
  void requestToStringProtectsCredentials() {
    var request = request("sensitive-test-password", validAgreements());
    assertThat(request.toString()).doesNotContain(request.password(), request.email());
  }

  private RegistrationService createService(RegistrationProperties properties) {
    return new RegistrationService(
        users, agreements, passwords, properties, validators.getValidator(), transactions);
  }

  private void allowPersistence() {
    when(passwords.encode(any())).thenReturn("encoded-test-value");
    when(users.saveAndFlush(any())).thenAnswer(invocation -> invocation.getArgument(0));
    when(transactions.execute(any()))
        .thenAnswer(
            invocation -> {
              TransactionCallback<?> callback = invocation.getArgument(0);
              return callback.doInTransaction(mock(TransactionStatus.class));
            });
  }

  private void assertBusiness(RegistrationRequest request, ErrorCode code) {
    assertThatThrownBy(() -> service.register(request))
        .isInstanceOf(BusinessException.class)
        .hasMessage(code.message());
  }

  private RegistrationRequest request(String password, List<AgreementRequest> agreements) {
    return new RegistrationRequest("member@example.test", password, agreements);
  }

  private List<AgreementRequest> validAgreements() {
    return List.of(
        new AgreementRequest(AgreementType.TERMS, "local-test-v1", true),
        new AgreementRequest(AgreementType.PRIVACY, "local-test-v1", true));
  }
}
