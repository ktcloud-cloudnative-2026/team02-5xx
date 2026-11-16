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
      if (e.getStatusCode().is4xxClientError()) {
        throw new BusinessException(ErrorCode.OUT_OF_STOCK);
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
      // 4xx: 확보가 없거나 만료되어 확정할 수 없음이 확실한 경우. 5xx: 결과를 알 수 없음.
      if (e.getStatusCode().is4xxClientError()) {
        throw new BusinessException(ErrorCode.STOCK_CONFIRM_FAILED);
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
