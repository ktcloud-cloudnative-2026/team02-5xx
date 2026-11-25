package com.peakorder.order.client;

import com.peakorder.order.dto.ApiResponse;
import com.peakorder.order.exception.BusinessException;
import com.peakorder.order.exception.ErrorCode;
import io.micrometer.core.instrument.MeterRegistry;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClientResponseException;

@Component
public class HttpInventoryClient implements InventoryClient {

  private static final Logger log = LoggerFactory.getLogger(HttpInventoryClient.class);

  /** Inventory II-01 409의 errorCode. 고객 응답은 같지만 원인이 달라 로그·지표로 구분한다(#270). */
  static final String INSUFFICIENT_STOCK = "INSUFFICIENT_STOCK";

  static final String STOCK_NOT_LINKED = "STOCK_NOT_LINKED";

  private final RestClient restClient;
  private final MeterRegistry meterRegistry;

  public HttpInventoryClient(
      @Qualifier("inventoryRestClient") RestClient restClient, MeterRegistry meterRegistry) {
    this.restClient = restClient;
    this.meterRegistry = meterRegistry;
  }

  /**
   * 409 본문의 errorCode로 원인을 구분한다. 읽을 수 없거나 모르는 값이면 {@code unknown}으로 두고, 어떤 경우에도 호출자에게는 기존처럼 재고 부족으로
   * 처리한다(고객 응답 계약 유지).
   */
  private static String rejectionReason(RestClientResponseException e) {
    String code = null;
    try {
      ApiResponse<?> body = e.getResponseBodyAs(ApiResponse.class);
      code = body == null ? null : body.errorCode();
    } catch (RuntimeException ignored) {
      // 본문이 JSON이 아니거나 비어 있음 → unknown
    }
    if (INSUFFICIENT_STOCK.equals(code)) {
      return "insufficient_stock";
    }
    if (STOCK_NOT_LINKED.equals(code)) {
      return "stock_not_linked";
    }
    return "unknown";
  }

  private void recordRejection(Long orderId, List<HoldLine> lines, String reason) {
    meterRegistry.counter("order.inventory.hold.rejected", "reason", reason).increment();
    if ("stock_not_linked".equals(reason)) {
      // 품절이 아니라 메뉴와 재고 항목의 연결 누락(운영 설정). 개인정보 없이 주문·메뉴 번호만 남긴다.
      log.warn(
          "재고 확보 거절: 재고가 연결되지 않은 메뉴 orderId={} menuIds={}",
          orderId,
          lines.stream().map(HoldLine::menuId).toList());
    }
  }

  @Override
  public StockHold hold(Long orderId, List<HoldLine> lines) {
    try {
      ApiResponse<StockHold> body =
          restClient
              .post()
              .uri("/internal/v1/inventory/holds")
              .body(new HoldRequest(orderId, lines))
              .retrieve()
              .body(new ParameterizedTypeReference<ApiResponse<StockHold>>() {});
      if (body == null
          || !body.success()
          || body.data() == null
          || body.data().holdId() == null
          || body.data().expiresAt() == null) {
        throw new BusinessException(ErrorCode.UPSTREAM_INVALID_RESPONSE);
      }
      return body.data();
    } catch (RestClientResponseException e) {
      // 409: 재고 부족(INSUFFICIENT_STOCK) 또는 재고 미연결(STOCK_NOT_LINKED)로 주문할 수 없음이 확실한 경우.
      // 그 밖의 4xx는 우리 요청이 잘못되었다는 뜻이라 재고 부족으로 단정하지 않는다.
      if (e.getStatusCode().value() == 409) {
        recordRejection(orderId, lines, rejectionReason(e));
        throw new BusinessException(ErrorCode.OUT_OF_STOCK);
      }
      if (e.getStatusCode().is4xxClientError()) {
        throw new BusinessException(ErrorCode.UPSTREAM_INVALID_RESPONSE);
      }
      throw new BusinessException(ErrorCode.INVENTORY_SERVICE_UNAVAILABLE);
    } catch (RestClientException e) {
      throw new BusinessException(ErrorCode.INVENTORY_SERVICE_UNAVAILABLE);
    }
  }

  @Override
  public void confirm(Long holdId) {
    try {
      restClient
          .post()
          .uri("/internal/v1/inventory/holds/{holdId}/confirm", holdId)
          .retrieve()
          .toBodilessEntity();
    } catch (RestClientResponseException e) {
      // 409(HOLD_NOT_ACTIVE: 만료·해제된 확보)와 404(HOLD_NOT_FOUND)만 "확정할 수 없음이 확실한" 경우다.
      // 결제 후 이 판단은 환불로 이어지므로, 그 밖의 4xx(요청·인증 오류 등)는 확정 실패로 단정하지 않는다.
      // 5xx·연결 실패는 결과를 알 수 없음.
      int status = e.getStatusCode().value();
      if (status == 409 || status == 404) {
        throw new BusinessException(ErrorCode.STOCK_CONFIRM_FAILED);
      }
      if (e.getStatusCode().is4xxClientError()) {
        throw new BusinessException(ErrorCode.UPSTREAM_INVALID_RESPONSE);
      }
      throw new BusinessException(ErrorCode.INVENTORY_SERVICE_UNAVAILABLE);
    } catch (RestClientException e) {
      throw new BusinessException(ErrorCode.INVENTORY_SERVICE_UNAVAILABLE);
    }
  }

  @Override
  public void release(Long holdId) {
    try {
      restClient
          .delete()
          .uri("/internal/v1/inventory/holds/{holdId}", holdId)
          .retrieve()
          .toBodilessEntity();
    } catch (RestClientException e) {
      throw new BusinessException(ErrorCode.INVENTORY_SERVICE_UNAVAILABLE);
    }
  }

  @Override
  public HoldRelease releaseHold(Long holdId) {
    try {
      restClient
          .delete()
          .uri("/internal/v1/inventory/holds/{holdId}", holdId)
          .retrieve()
          .toBodilessEntity();
      return HoldRelease.RELEASED;
    } catch (RestClientResponseException e) {
      int status = e.getStatusCode().value();
      // 409: 이미 확정된 확보. 404: Inventory에 없는 확보라 반환할 재고도 없다(해제된 것과 같다).
      if (status == 409) {
        return HoldRelease.ALREADY_CONFIRMED;
      }
      if (status == 404) {
        return HoldRelease.RELEASED;
      }
      if (e.getStatusCode().is4xxClientError()) {
        throw new BusinessException(ErrorCode.UPSTREAM_INVALID_RESPONSE);
      }
      throw new BusinessException(ErrorCode.INVENTORY_SERVICE_UNAVAILABLE);
    } catch (RestClientException e) {
      throw new BusinessException(ErrorCode.INVENTORY_SERVICE_UNAVAILABLE);
    }
  }

  @Override
  public RestoreResult restore(Long orderId) {
    try {
      restClient
          .post()
          .uri("/internal/v1/inventory/restorations")
          .body(new RestoreRequest(orderId))
          .retrieve()
          .toBodilessEntity();
      return RestoreResult.RESTORED;
    } catch (RestClientResponseException e) {
      // 409 RESTORE_NOT_APPLICABLE만 합의된 "복원 불가". 그 밖의 4xx는 계약 위반, 5xx는 결과 불명이다.
      if (e.getStatusCode().value() == 409) {
        return RestoreResult.NOT_APPLICABLE;
      }
      if (e.getStatusCode().is4xxClientError()) {
        throw new BusinessException(ErrorCode.UPSTREAM_INVALID_RESPONSE);
      }
      throw new BusinessException(ErrorCode.INVENTORY_SERVICE_UNAVAILABLE);
    } catch (RestClientException e) {
      throw new BusinessException(ErrorCode.INVENTORY_SERVICE_UNAVAILABLE);
    }
  }

  record RestoreRequest(Long orderId) {}

  record HoldRequest(Long orderId, List<HoldLine> items) {}
}
