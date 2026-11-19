package com.peakorder.order.client;

import com.peakorder.order.dto.ApiResponse;
import com.peakorder.order.exception.BusinessException;
import com.peakorder.order.exception.ErrorCode;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClientResponseException;

@Component
public class HttpPaymentClient implements PaymentClient {

  private final RestClient restClient;

  public HttpPaymentClient(@Qualifier("paymentRestClient") RestClient restClient) {
    this.restClient = restClient;
  }

  @Override
  public PaymentResult pay(Long orderId, int amount, String idempotencyKey) {
    try {
      ApiResponse<PaymentResult> body =
          restClient
              .post()
              .uri("/internal/v1/payments")
              .body(new PaymentRequest(orderId, amount, idempotencyKey))
              .retrieve()
              .body(new ParameterizedTypeReference<ApiResponse<PaymentResult>>() {});
      if (body == null
          || !body.success()
          || body.data() == null
          || body.data().paymentId() == null
          || !(body.data().isSuccess() || body.data().isFailed() || body.data().isRefunded())) {
        throw new BusinessException(ErrorCode.UPSTREAM_INVALID_RESPONSE);
      }
      return body.data();
    } catch (RestClientResponseException e) {
      // 4xx는 우리 요청이 거부된 것이라 결제 결과를 알 수 없다. 성공·실패를 임의로 정하지 않는다.
      if (e.getStatusCode().is4xxClientError()) {
        throw new BusinessException(ErrorCode.UPSTREAM_INVALID_RESPONSE);
      }
      throw new BusinessException(ErrorCode.PAYMENT_SERVICE_UNAVAILABLE);
    } catch (RestClientException e) {
      throw new BusinessException(ErrorCode.PAYMENT_SERVICE_UNAVAILABLE);
    }
  }

  /**
   * 환불(PI-03). 환불됐음(200 {@code status: REFUNDED})을 확인한 경우에만 정상 반환한다. 이미 환불된 결제도 같은 200이라 재호출해도 중복
   * 환불이 없다. 409 PAYMENT_NOT_REFUNDABLE(승인되지 않은 결제)은 다시 호출해도 결과가 같은 "환불 불가"라
   * PAYMENT_NOT_REFUNDABLE로, 그 밖의 4xx(없는 결제 등)와 계약과 다른 응답은 UPSTREAM_INVALID_RESPONSE로 구분한다. 5xx·연결
   * 실패·타임아웃만 결과를 알 수 없는 오류(PAYMENT_SERVICE_UNAVAILABLE)로 재시도 대상이다.
   */
  @Override
  public void refund(Long paymentId) {
    try {
      ApiResponse<PaymentResult> body =
          restClient
              .post()
              .uri("/internal/v1/payments/{paymentId}/refund", paymentId)
              .retrieve()
              .body(new ParameterizedTypeReference<ApiResponse<PaymentResult>>() {});
      if (body == null
          || !body.success()
          || body.data() == null
          || !body.data().isRefunded()
          || !paymentId.equals(body.data().paymentId())) {
        throw new BusinessException(ErrorCode.UPSTREAM_INVALID_RESPONSE);
      }
    } catch (RestClientResponseException e) {
      if (e.getStatusCode().value() == 409) {
        throw new BusinessException(ErrorCode.PAYMENT_NOT_REFUNDABLE);
      }
      if (e.getStatusCode().is4xxClientError()) {
        throw new BusinessException(ErrorCode.UPSTREAM_INVALID_RESPONSE);
      }
      throw new BusinessException(ErrorCode.PAYMENT_SERVICE_UNAVAILABLE);
    } catch (RestClientException e) {
      throw new BusinessException(ErrorCode.PAYMENT_SERVICE_UNAVAILABLE);
    }
  }

  record PaymentRequest(Long orderId, int amount, String idempotencyKey) {}
}
