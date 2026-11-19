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

  /**
   * 결제를 취소·환불한다. 이미 환불된 결제는 Payment가 중복 환불하지 않고 같은 200으로 응답하므로 재호출해도 안전하다.
   *
   * @throws com.peakorder.order.exception.BusinessException 환불됨을 확인하지 못하면 던진다. 승인되지 않은 결제(409)는
   *     PAYMENT_NOT_REFUNDABLE, 그 밖의 4xx·계약과 다른 응답은 UPSTREAM_INVALID_RESPONSE(둘 다 다시 호출해도 결과가 같아 수동
   *     확인 대상), 5xx·시간 초과는 PAYMENT_SERVICE_UNAVAILABLE(재시도 대상)
   */
  void refund(Long paymentId);

  /**
   * status: SUCCESS, FAILED, REFUNDED. FAILED는 결제 실패가 확정된 경우, REFUNDED는 이미 환불된 결제(같은 키로 다시 호출했을 때)로
   * 돈이 나가지 않은 상태다.
   */
  record PaymentResult(Long paymentId, String status) {

    public boolean isSuccess() {
      return "SUCCESS".equals(status);
    }

    public boolean isRefunded() {
      return "REFUNDED".equals(status);
    }

    public boolean isFailed() {
      return "FAILED".equals(status);
    }
  }
}
