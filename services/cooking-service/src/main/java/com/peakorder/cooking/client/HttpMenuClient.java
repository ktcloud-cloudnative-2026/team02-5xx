package com.peakorder.cooking.client;

import com.peakorder.cooking.exception.BusinessException;
import com.peakorder.cooking.exception.ErrorCode;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.HttpServerErrorException;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

/**
 * MI-01 `POST /internal/v1/menus/validate-purchase` 호출.
 *
 * <ul>
 *   <li>Menu 4xx(판매 불가·잘못된 옵션) → MENU_NOT_AVAILABLE (409, Order와 같은 코드)
 *   <li>Menu 5xx·연결 실패·타임아웃 → MENU_SERVICE_UNAVAILABLE (503)
 *   <li>응답 형식이 계약과 다름 → UPSTREAM_INVALID_RESPONSE (502)
 * </ul>
 */
@Component
public class HttpMenuClient implements MenuClient {

  static final String VALIDATE_PURCHASE_PATH = "/internal/v1/menus/validate-purchase";

  private static final Logger log = LoggerFactory.getLogger(HttpMenuClient.class);

  private final RestClient menuRestClient;

  public HttpMenuClient(RestClient menuRestClient) {
    this.menuRestClient = menuRestClient;
  }

  @Override
  public List<ValidatedMenu> validatePurchase(List<PurchaseLine> lines) {
    MenuResponse response;
    try {
      response =
          menuRestClient
              .post()
              .uri(VALIDATE_PURCHASE_PATH)
              .contentType(MediaType.APPLICATION_JSON)
              .body(new MenuRequest(lines))
              .retrieve()
              .body(MenuResponse.class);
    } catch (HttpClientErrorException e) {
      throw new BusinessException(ErrorCode.MENU_NOT_AVAILABLE);
    } catch (HttpServerErrorException | ResourceAccessException e) {
      log.warn("Menu MI-01 호출 실패: {}", e.getClass().getSimpleName());
      throw new BusinessException(ErrorCode.MENU_SERVICE_UNAVAILABLE);
    } catch (RestClientException e) {
      log.warn("Menu MI-01 응답을 읽을 수 없음: {}", e.getClass().getSimpleName());
      throw new BusinessException(ErrorCode.UPSTREAM_INVALID_RESPONSE);
    }
    return validated(response, lines.size());
  }

  private static List<ValidatedMenu> validated(MenuResponse response, int expectedSize) {
    if (response == null
        || !response.success()
        || response.data() == null
        || response.data().items() == null
        || response.data().items().size() != expectedSize) {
      throw new BusinessException(ErrorCode.UPSTREAM_INVALID_RESPONSE);
    }
    for (ValidatedMenu menu : response.data().items()) {
      boolean invalid =
          menu == null
              || menu.cookTimeSec() < 0
              || menu.options() == null
              || menu.options().stream().anyMatch(o -> o == null || o.extraCookTimeSec() < 0);
      if (invalid) {
        throw new BusinessException(ErrorCode.UPSTREAM_INVALID_RESPONSE);
      }
    }
    return response.data().items();
  }

  /** MI-01 요청 본문 */
  record MenuRequest(List<PurchaseLine> items) {}

  /** MI-01 응답 본문 (공통 응답 형식). 가격 필드는 Cooking에서 쓰지 않아 받지 않는다 */
  record MenuResponse(boolean success, Data data, String message, String errorCode) {}

  record Data(List<ValidatedMenu> items) {}
}
