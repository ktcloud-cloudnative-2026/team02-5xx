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
public class HttpCookingClient implements CookingClient {

  private final RestClient restClient;

  public HttpCookingClient(@Qualifier("cookingCommandRestClient") RestClient restClient) {
    this.restClient = restClient;
  }

  @Override
  public CancelResult cancel(Long orderId) {
    try {
      ApiResponse<CancelBody> body =
          restClient
              .post()
              .uri("/internal/v1/cooking/orders/{orderId}/cancel", orderId)
              .retrieve()
              .body(new ParameterizedTypeReference<ApiResponse<CancelBody>>() {});
      // 취소됨(CANCELED)을 확인한 응답만 성공으로 본다. 다른 값이면 취소를 확정하지 않는다.
      if (body == null
          || !body.success()
          || body.data() == null
          || !"CANCELED".equals(body.data().status())) {
        throw new BusinessException(ErrorCode.UPSTREAM_INVALID_RESPONSE);
      }
      return CancelResult.CANCELED;
    } catch (RestClientResponseException e) {
      CancelResult agreed = agreedRejection(e);
      if (agreed != null) {
        return agreed;
      }
      if (e.getStatusCode().is4xxClientError()) {
        throw new BusinessException(ErrorCode.UPSTREAM_INVALID_RESPONSE);
      }
      throw new BusinessException(ErrorCode.COOKING_SERVICE_UNAVAILABLE);
    } catch (RestClientException e) {
      throw new BusinessException(ErrorCode.COOKING_SERVICE_UNAVAILABLE);
    }
  }

  /**
   * 합의한 409(조리 시작·완료)·404(전표 없음)만 의미 있는 결과로 본다. 그 밖의 4xx는 계약 위반(502), 5xx는 결과 불명(503)이다. 404라도
   * errorCode가 COOKING_TICKET_NOT_FOUND가 아니면(경로 오류 등) "접수 처리 중"으로 보지 않는다.
   */
  private static CancelResult agreedRejection(RestClientResponseException e) {
    int status = e.getStatusCode().value();
    String errorCode = errorCodeOf(e);
    if (status == 409 && "COOKING_ALREADY_STARTED".equals(errorCode)) {
      return CancelResult.ALREADY_STARTED;
    }
    if (status == 409 && "COOKING_ALREADY_DONE".equals(errorCode)) {
      return CancelResult.ALREADY_DONE;
    }
    if (status == 404 && "COOKING_TICKET_NOT_FOUND".equals(errorCode)) {
      return CancelResult.TICKET_NOT_FOUND;
    }
    return null;
  }

  private static String errorCodeOf(RestClientResponseException e) {
    try {
      ApiResponse<?> body = e.getResponseBodyAs(ApiResponse.class);
      return body == null ? null : body.errorCode();
    } catch (RuntimeException ignored) {
      return null;
    }
  }

  record CancelBody(Long orderId, String status) {}
}
