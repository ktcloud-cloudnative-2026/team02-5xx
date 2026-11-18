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

  @Override
  public void refund(Long paymentId) {
    try {
      restClient
          .post()
          .uri("/internal/v1/payments/{paymentId}/refund", paymentId)
          .retrieve()
          .toBodilessEntity();
    } catch (RestClientException e) {
      throw new BusinessException(ErrorCode.PAYMENT_SERVICE_UNAVAILABLE);
    }
  }

  record PaymentRequest(Long orderId, int amount, String idempotencyKey) {}
}
