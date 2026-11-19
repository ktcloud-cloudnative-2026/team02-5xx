package com.peakorder.payment.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.peakorder.payment.dto.PaymentRequest;
import com.peakorder.payment.dto.PaymentResponse;
import com.peakorder.payment.entity.Payment;
import com.peakorder.payment.entity.PaymentRefund;
import com.peakorder.payment.entity.PaymentStatus;
import com.peakorder.payment.exception.BusinessException;
import com.peakorder.payment.exception.ErrorCode;
import com.peakorder.payment.repository.PaymentRefundRepository;
import com.peakorder.payment.repository.PaymentRepository;
import java.time.Clock;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;

class PaymentServiceTest {

  private final OffsetDateTime now = OffsetDateTime.parse("2026-11-17T10:00:00+09:00");
  private final Clock clock = Clock.fixed(now.toInstant(), ZoneId.of("Asia/Seoul"));

  private PaymentRepository paymentRepository;
  private PaymentRefundRepository refundRepository;

  @BeforeEach
  void setUp() {
    paymentRepository = mock(PaymentRepository.class);
    refundRepository = mock(PaymentRefundRepository.class);
    when(paymentRepository.findByIdempotencyKey(any())).thenReturn(Optional.empty());
    when(paymentRepository.findByOrderId(any())).thenReturn(Optional.empty());
    when(paymentRepository.saveAndFlush(any(Payment.class))).thenAnswer(inv -> inv.getArgument(0));
  }

  private PaymentService service(String mockResult) {
    return new PaymentService(
        paymentRepository, refundRepository, new MockPaymentGateway(mockResult), clock);
  }

  private PaymentRequest request() {
    return new PaymentRequest(1L, 6500, "order-1");
  }

  @Test
  void new_request_is_approved_by_default() {
    PaymentResponse res = service("APPROVE").pay(request());

    assertThat(res.status()).isEqualTo("SUCCESS");
    verify(paymentRepository).saveAndFlush(any(Payment.class));
  }

  @Test
  void mock_fail_setting_returns_failed() {
    PaymentResponse res = service("FAIL").pay(request());

    assertThat(res.status()).isEqualTo("FAILED");
  }

  @Test
  void same_key_returns_first_result_without_new_payment() {
    Payment first = Payment.failed(1L, "order-1", 6500, "MOCK_DECLINED", now);
    when(paymentRepository.findByIdempotencyKey("order-1")).thenReturn(Optional.of(first));

    // 설정이 APPROVE로 바뀌어도 처음 결과(FAILED)를 그대로 돌려준다
    PaymentResponse res = service("APPROVE").pay(request());

    assertThat(res.status()).isEqualTo("FAILED");
    verify(paymentRepository, never()).saveAndFlush(any());
  }

  @Test
  void same_key_with_different_amount_is_conflict() {
    Payment first = Payment.approved(1L, "order-1", 9000, "MOCK-1", now);
    when(paymentRepository.findByIdempotencyKey("order-1")).thenReturn(Optional.of(first));

    assertThatThrownBy(() -> service("APPROVE").pay(request()))
        .isInstanceOfSatisfying(
            BusinessException.class,
            e -> assertThat(e.errorCode()).isEqualTo(ErrorCode.IDEMPOTENCY_KEY_CONFLICT));
  }

  @Test
  void second_payment_for_same_order_with_new_key_is_conflict() {
    Payment first = Payment.approved(1L, "other-key", 6500, "MOCK-1", now);
    when(paymentRepository.findByOrderId(1L)).thenReturn(Optional.of(first));

    assertThatThrownBy(() -> service("APPROVE").pay(request()))
        .isInstanceOfSatisfying(
            BusinessException.class,
            e -> assertThat(e.errorCode()).isEqualTo(ErrorCode.PAYMENT_ALREADY_EXISTS));
  }

  @Test
  void concurrent_duplicate_returns_saved_result() {
    Payment saved = Payment.approved(1L, "order-1", 6500, "MOCK-1", now);
    when(paymentRepository.saveAndFlush(any(Payment.class)))
        .thenThrow(new DataIntegrityViolationException("uk_payments_idempotency_key"));
    when(paymentRepository.findByIdempotencyKey("order-1"))
        .thenReturn(Optional.empty())
        .thenReturn(Optional.of(saved));

    PaymentResponse res = service("APPROVE").pay(request());

    assertThat(res.status()).isEqualTo("SUCCESS");
  }

  @Test
  void refund_approved_payment() {
    Payment p = Payment.approved(1L, "order-1", 6500, "MOCK-1", now);
    when(paymentRepository.findByIdForUpdate(10L)).thenReturn(Optional.of(p));

    PaymentResponse res = service("APPROVE").refund(10L);

    assertThat(res.status()).isEqualTo("REFUNDED");
    assertThat(p.getStatus()).isEqualTo(PaymentStatus.REFUNDED);
    assertThat(p.getCanceledAt()).isEqualTo(now);
    verify(refundRepository).save(any(PaymentRefund.class));
  }

  @Test
  void refund_again_is_same_200_without_second_refund() {
    Payment p = Payment.approved(1L, "order-1", 6500, "MOCK-1", now);
    p.markRefunded(now);
    when(paymentRepository.findByIdForUpdate(10L)).thenReturn(Optional.of(p));

    PaymentResponse res = service("APPROVE").refund(10L);

    assertThat(res.status()).isEqualTo("REFUNDED");
    verify(refundRepository, never()).save(any());
  }

  @Test
  void refund_failed_payment_is_conflict() {
    Payment p = Payment.failed(1L, "order-1", 6500, "MOCK_DECLINED", now);
    when(paymentRepository.findByIdForUpdate(10L)).thenReturn(Optional.of(p));

    assertThatThrownBy(() -> service("APPROVE").refund(10L))
        .isInstanceOfSatisfying(
            BusinessException.class,
            e -> assertThat(e.errorCode()).isEqualTo(ErrorCode.PAYMENT_NOT_REFUNDABLE));
    verify(refundRepository, never()).save(any());
  }

  @Test
  void refund_unknown_payment_is_not_found() {
    when(paymentRepository.findByIdForUpdate(99L)).thenReturn(Optional.empty());

    assertThatThrownBy(() -> service("APPROVE").refund(99L))
        .isInstanceOfSatisfying(
            BusinessException.class,
            e -> assertThat(e.errorCode()).isEqualTo(ErrorCode.PAYMENT_NOT_FOUND));
  }
}
