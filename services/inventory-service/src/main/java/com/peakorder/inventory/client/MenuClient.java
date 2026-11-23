package com.peakorder.inventory.client;

import com.peakorder.inventory.dto.ApiResponse;
import com.peakorder.inventory.exception.BusinessException;
import com.peakorder.inventory.exception.ErrorCode;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

/** Menu 서비스 호출. MI-02 메뉴 존재 확인. */
@Component
public class MenuClient {

  private final RestClient restClient;

  public MenuClient(@Qualifier("menuRestClient") RestClient restClient) {
    this.restClient = restClient;
  }

  public MenuExistence checkExistence(Long menuId) {
    try {
      ApiResponse<MenuExistence> body =
          restClient
              .get()
              .uri("/internal/v1/menus/{menuId}/existence", menuId)
              .retrieve()
              .body(new ParameterizedTypeReference<ApiResponse<MenuExistence>>() {});
      if (body == null || !body.success() || body.data() == null) {
        throw new BusinessException(ErrorCode.MENU_SERVICE_UNAVAILABLE);
      }
      return body.data();
    } catch (RestClientException e) {
      throw new BusinessException(ErrorCode.MENU_SERVICE_UNAVAILABLE);
    }
  }

  public record MenuExistence(Long menuId, boolean exists, String status) {}
}
