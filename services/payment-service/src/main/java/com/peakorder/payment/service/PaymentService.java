package com.peakorder.payment.service;

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
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class PaymentService {

  private static final Logger log = LoggerFactory.getLogger(PaymentService.class);
  static final String REFUND_REASON = "CUSTOMER_CANCEL";

  private final PaymentRepository paymentRepository;
  private final PaymentRefundRepository refundRepository;
  private final MockPaymentGateway gateway;
  private final Clock clock;

  public PaymentService(
      PaymentRepository paymentRepository,
      PaymentRefundRepository refundRepository,
      MockPaymentGateway gateway,
      Clock clock) {
    this.paymentRepository = paymentRepository;
    this.refundRepository = refundRepository;
    this.gateway = gateway;
    this.clock = clock;
  }

  /**
   * PI-01 모의 결제.
   *
   * <p>같은 idempotencyKey로 다시 오면 새로 결제하지 않고 처음 결과(성공·실패)를 그대로 돌려준다. 동시에 두 번 와도 DB의 UNIQUE 제약 때문에 한
   * 건만 저장되고, 늦은 쪽은 먼저 저장된 결과를 돌려준다.
   */
  public PaymentResponse pay(PaymentRequest req) {
    Optional<Payment> existing = findReplay(req);
    if (existing.isPresent()) {
      return PaymentResponse.from(existing.get());
    }

    OffsetDateTime now = OffsetDateTime.now(clock);
    String mockTxId = gateway.approve(req.orderId(), req.amount());
    Payment payment =
        mockTxId != null
            ? Payment.approved(req.orderId(), req.idempotencyKey(), req.amount(), mockTxId, now)
            : Payment.failed(
                req.orderId(),
                req.idempotencyKey(),
                req.amount(),
                MockPaymentGateway.DECLINED_REASON,
                now);

    try {
      Payment saved = paymentRepository.saveAndFlush(payment);
      log.info(
          "결제 처리 orderId={} paymentId={} status={}",
          saved.getOrderId(),
          saved.getId(),
          saved.getStatus());
      return PaymentResponse.from(saved);
    } catch (DataIntegrityViolationException e) {
      // 같은 요청이 동시에 들어와 다른 쪽이 먼저 저장했다. 그 결과를 돌려준다.
      return findReplay(req)
          .map(PaymentResponse::from)
          .orElseThrow(() -> new BusinessException(ErrorCode.PAYMENT_ALREADY_EXISTS));
    }
  }

  /** 이미 처리한 같은 요청이면 그 결제를, 처음 보는 요청이면 empty. 다른 요청과 겹치면 409. */
  private Optional<Payment> findReplay(PaymentRequest req) {
    Optional<Payment> byKey = paymentRepository.findByIdempotencyKey(req.idempotencyKey());
    if (byKey.isPresent()) {
      if (!byKey.get().isSameRequest(req.orderId(), req.amount())) {
        throw new BusinessException(ErrorCode.IDEMPOTENCY_KEY_CONFLICT);
      }
      return byKey;
    }
    if (paymentRepository.findByOrderId(req.orderId()).isPresent()) {
      // 주문당 결제는 1건. 결제 재시도는 새 임시 주문(새 orderId)으로 해야 한다.
      throw new BusinessException(ErrorCode.PAYMENT_ALREADY_EXISTS);
    }
    return Optional.empty();
  }

  /** PI-02 결제 결과 조회. Order가 PI-01 응답을 못 받았을 때 확인용. */
  @Transactional(readOnly = true)
  public PaymentResponse get(Long paymentId) {
    return paymentRepository
        .findById(paymentId)
        .map(PaymentResponse::from)
        .orElseThrow(() -> new BusinessException(ErrorCode.PAYMENT_NOT_FOUND));
  }

  /**
   * PI-03 환불.
   *
   * <p>결제 행을 잠근 뒤 상태를 다시 확인하므로 동시에 두 번 와도 환불은 한 번만 된다. 이미 환불된 결제는 같은 200으로 응답한다(멱등).
   */
  @Transactional
  public PaymentResponse refund(Long paymentId) {
    Payment payment =
        paymentRepository
            .findByIdForUpdate(paymentId)
            .orElseThrow(() -> new BusinessException(ErrorCode.PAYMENT_NOT_FOUND));

    if (payment.getStatus() == PaymentStatus.REFUNDED) {
      return PaymentResponse.from(payment);
    }
    if (payment.getStatus() != PaymentStatus.APPROVED) {
      throw new BusinessException(ErrorCode.PAYMENT_NOT_REFUNDABLE);
    }

    OffsetDateTime now = OffsetDateTime.now(clock);
    refundRepository.save(PaymentRefund.completed(payment, REFUND_REASON, now));
    payment.markRefunded(now);
    log.info("환불 완료 orderId={} paymentId={}", payment.getOrderId(), payment.getId());
    return PaymentResponse.from(payment);
  }
}
