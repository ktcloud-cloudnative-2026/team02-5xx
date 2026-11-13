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
public class HttpMenuClient implements MenuClient {

  private final RestClient restClient;

  public HttpMenuClient(@Qualifier("menuRestClient") RestClient restClient) {
    this.restClient = restClient;
  }

  @Override
  public List<ValidatedMenu> validatePurchase(List<PurchaseLine> lines) {
    try {
      ApiResponse<ValidationData> body =
          restClient
              .post()
              .uri("/internal/v1/menus/validate-purchase")
              .body(new ValidationRequest(lines))
              .retrieve()
              .body(new ParameterizedTypeReference<ApiResponse<ValidationData>>() {});
      if (body == null || !body.success() || body.data() == null || body.data().items() == null) {
        throw new BusinessException(ErrorCode.UPSTREAM_INVALID_RESPONSE);
      }
      return body.data().items();
    } catch (RestClientResponseException e) {
      if (e.getStatusCode().is4xxClientError()) {
        throw new BusinessException(ErrorCode.MENU_NOT_AVAILABLE);
      }
      throw new BusinessException(ErrorCode.MENU_SERVICE_UNAVAILABLE);
    } catch (RestClientException e) {
      throw new BusinessException(ErrorCode.MENU_SERVICE_UNAVAILABLE);
    }
  }

  record ValidationRequest(List<PurchaseLine> items) {}

  record ValidationData(List<ValidatedMenu> items) {}
}
