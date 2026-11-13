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

  record HoldRequest(Long orderId, List<HoldLine> items) {}
}
