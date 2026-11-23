package com.peakorder.payment.dto;

import static org.assertj.core.api.Assertions.assertThat;

import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validation;
import jakarta.validation.Validator;
import jakarta.validation.ValidatorFactory;
import java.util.Set;
import java.util.stream.Collectors;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

class PaymentRequestValidationTest {

  private static ValidatorFactory factory;
  private static Validator validator;

  @BeforeAll
  static void setUp() {
    factory = Validation.buildDefaultValidatorFactory();
    validator = factory.getValidator();
  }

  @AfterAll
  static void tearDown() {
    factory.close();
  }

  private Set<String> messages(PaymentRequest req) {
    return validator.validate(req).stream()
        .map(ConstraintViolation::getMessage)
        .collect(Collectors.toSet());
  }

  @Test
  void valid_request_has_no_errors() {
    assertThat(messages(new PaymentRequest(1L, 1000, "order-1"))).isEmpty();
  }

  @Test
  void zero_amount_message_is_korean() {
    assertThat(messages(new PaymentRequest(1L, 0, "order-1")))
        .containsExactly("amount는 0보다 커야 합니다.");
  }

  @Test
  void missing_fields_messages_are_korean() {
    assertThat(messages(new PaymentRequest(null, null, " ")))
        .containsExactlyInAnyOrder("orderId는 필수입니다.", "amount는 필수입니다.", "idempotencyKey는 필수입니다.");
  }

  @Test
  void too_long_idempotency_key_message_is_korean() {
    assertThat(messages(new PaymentRequest(1L, 1000, "k".repeat(101))))
        .containsExactly("idempotencyKey는 100자 이하여야 합니다.");
  }
}
