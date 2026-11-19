package com.peakorder.order.client;

import com.peakorder.order.dto.ApiResponse;
import com.peakorder.order.exception.BusinessException;
import com.peakorder.order.exception.ErrorCode;
import java.time.OffsetDateTime;
import java.util.Optional;
import java.util.Set;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClientResponseException;

@Component
public class HttpCookingClient implements CookingClient {

  private static final Set<String> STATUSES = Set.of("WAITING", "COOKING", "DONE", "CANCELED");

  private final RestClient restClient;
  private final RestClient queryRestClient;

  public HttpCookingClient(
      @Qualifier("cookingCommandRestClient") RestClient restClient,
      @Qualifier("cookingQueryRestClient") RestClient queryRestClient) {
    this.restClient = restClient;
    this.queryRestClient = queryRestClient;
  }

  @Override
  public Optional<CookingStatus> getStatus(Long orderId) {
    try {
      ApiResponse<StatusBody> body =
          queryRestClient
              .get()
              .uri("/internal/v1/cooking/orders/{orderId}", orderId)
              .retrieve()
              .body(new ParameterizedTypeReference<ApiResponse<StatusBody>>() {});
      if (body == null || !body.success() || body.data() == null) {
        throw new BusinessException(ErrorCode.UPSTREAM_INVALID_RESPONSE);
      }
      // 다른 주문의 조리 상태를 보여 주지 않도록 요청한 주문의 응답인지 확인한다.
      if (!orderId.equals(body.data().orderId())) {
        throw new BusinessException(ErrorCode.UPSTREAM_INVALID_RESPONSE);
      }
      return Optional.of(toStatus(body.data()));
    } catch (RestClientResponseException e) {
      if (e.getStatusCode().value() == 404 && "COOKING_TICKET_NOT_FOUND".equals(errorCodeOf(e))) {
        return Optional.empty();
      }
      if (e.getStatusCode().is4xxClientError()) {
        throw new BusinessException(ErrorCode.UPSTREAM_INVALID_RESPONSE);
      }
      throw new BusinessException(ErrorCode.COOKING_SERVICE_UNAVAILABLE);
    } catch (RestClientException e) {
      throw new BusinessException(ErrorCode.COOKING_SERVICE_UNAVAILABLE);
    }
  }

  /** 응답이 계약대로인지 확인한다. expectedWaitSec는 조리 시작까지, expectedReadySec는 조리 완료까지(초)다. */
  private static CookingStatus toStatus(StatusBody b) {
    if (b.status() == null
        || !STATUSES.contains(b.status())
        || b.waitingAhead() == null
        || b.estimatedCookSec() == null
        || b.expectedWaitSec() == null
        || b.expectedReadySec() == null
        || b.waitingAhead() < 0
        || b.estimatedCookSec() < 0
        || b.expectedWaitSec() < 0
        || b.expectedReadySec() < 0) {
      throw new BusinessException(ErrorCode.UPSTREAM_INVALID_RESPONSE);
    }
    return new CookingStatus(
        b.status(),
        b.waitingAhead(),
        b.estimatedCookSec(),
        b.expectedWaitSec(),
        b.expectedReadySec(),
        b.startedAt());
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

  record StatusBody(
      Long orderId,
      String status,
      Long waitingAhead,
      Integer estimatedCookSec,
      Long expectedWaitSec,
      Long expectedReadySec,
      OffsetDateTime startedAt) {}
}
