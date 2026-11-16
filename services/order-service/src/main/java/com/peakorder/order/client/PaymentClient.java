package com.peakorder.order.client;

/**
 * Payment Service 내부 API 호출. 요청·응답 필드는 초안이며 Payment 담당자와 합의 후 확정한다.
 *
 * <ul>
 *   <li>PI-01 POST /internal/v1/payments
 *   <li>PI-03 POST /internal/v1/payments/{paymentId}/refund
 * </ul>
 */
public interface PaymentClient {

  /**
   * 모의 결제를 요청한다. 같은 idempotencyKey의 반복 요청은 Payment가 중복 결제하지 않고 기존 결과를 돌려준다.
   *
   * @throws com.peakorder.order.exception.BusinessException 결과를 알 수 없으면
   *     PAYMENT_SERVICE_UNAVAILABLE. 이때 결제 성공·실패를 임의로 정하면 안 된다.
   */
  PaymentResult pay(Long orderId, int amount, String idempotencyKey);

  /** 결제를 취소·환불한다. 이미 환불된 결제는 Payment가 중복 환불하지 않는다. */
  void refund(Long paymentId);

  /** status: SUCCESS 또는 FAILED. FAILED는 결제 실패가 확정된 경우다. */
  record PaymentResult(Long paymentId, String status) {

    public boolean isSuccess() {
      return "SUCCESS".equals(status);
    }

    public boolean isFailed() {
      return "FAILED".equals(status);
    }
  }
}
