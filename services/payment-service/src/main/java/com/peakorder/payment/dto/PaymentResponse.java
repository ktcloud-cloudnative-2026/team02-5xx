package com.peakorder.payment.dto;

import com.peakorder.payment.entity.Payment;
import com.peakorder.payment.entity.PaymentStatus;

/**
 * PI-01·PI-02·PI-03 응답. Order의 PaymentResult(paymentId, status)와 필드를 똑같이 맞췄다.
 *
 * <p>status: SUCCESS(승인), FAILED(실패 확정), REFUNDED(환불 완료). DB 상태 APPROVED는 SUCCESS로 내보낸다.
 */
public record PaymentResponse(Long paymentId, String status) {

  public static PaymentResponse from(Payment p) {
    return new PaymentResponse(p.getId(), apiStatus(p.getStatus()));
  }

  static String apiStatus(PaymentStatus status) {
    return switch (status) {
      case APPROVED -> "SUCCESS";
      case FAILED -> "FAILED";
      case REFUNDED -> "REFUNDED";
      case REQUESTED -> "REQUESTED";
      case CANCELED -> "CANCELED";
    };
  }
}
