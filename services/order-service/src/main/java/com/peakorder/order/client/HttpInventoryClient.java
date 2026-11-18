package com.peakorder.order.client;

import com.peakorder.order.dto.ApiResponse;
import com.peakorder.order.exception.BusinessException;
import com.peakorder.order.exception.ErrorCode;
import java.util.List;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClientResponseException;

@Component
public class HttpInventoryClient implements InventoryClient {

  private final RestClient restClient;

  public HttpInventoryClient(@Qualifier("inventoryRestClient") RestClient restClient) {
    this.restClient = restClient;
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

  record HoldRequest(Long orderId, List<HoldLine> items) {}
}
