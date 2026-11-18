package com.peakorder.cooking.client;

import com.peakorder.cooking.exception.BusinessException;
import com.peakorder.cooking.exception.ErrorCode;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
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
    return validated(response, lines);
  }

  /**
   * 응답이 요청과 짝이 맞는지 검증한다. MI-01은 요청 순서를 유지한다고 명시하지만(#90), 그 보장에만 기대지 않고 i번째 응답이 i번째 요청과 같은 메뉴·옵션인지
   * 확인한다. 같은 메뉴를 옵션만 다르게 여러 줄 담을 수 있어 menuId만으로 짝을 찾지 않는다. 시간 필드가 빠지면(null) 0으로 계산되지 않도록 실패시킨다. 위반
   * 시 틀린 예상 시간 대신 502를 돌려준다(PR #106 리뷰).
   */
  private static List<ValidatedMenu> validated(MenuResponse response, List<PurchaseLine> lines) {
    if (response == null
        || !response.success()
        || response.data() == null
        || response.data().items() == null
        || response.data().items().size() != lines.size()) {
      throw invalidResponse("응답 항목 수가 요청과 다름");
    }
    for (int i = 0; i < lines.size(); i++) {
      ValidatedMenu menu = response.data().items().get(i);
      PurchaseLine line = lines.get(i);
      if (menu == null || !line.menuId().equals(menu.menuId())) {
        throw invalidResponse("응답 menuId가 요청과 다름");
      }
      if (menu.cookTimeSec() == null || menu.cookTimeSec() < 0 || menu.options() == null) {
        throw invalidResponse("cookTimeSec 또는 options 누락·음수");
      }
      Set<Long> responseOptionIds = new HashSet<>();
      for (ValidatedOption option : menu.options()) {
        if (option == null
            || option.optionId() == null
            || option.extraCookTimeSec() == null
            || option.extraCookTimeSec() < 0) {
          throw invalidResponse("옵션 필드 누락·음수");
        }
        responseOptionIds.add(option.optionId());
      }
      if (responseOptionIds.size() != menu.options().size()
          || !responseOptionIds.equals(new HashSet<>(line.optionIds()))) {
        throw invalidResponse("응답 옵션이 요청과 다름");
      }
    }
    return response.data().items();
  }

  private static BusinessException invalidResponse(String reason) {
    log.warn("Menu MI-01 응답이 계약과 다름: {}", reason);
    return new BusinessException(ErrorCode.UPSTREAM_INVALID_RESPONSE);
  }

  /** MI-01 요청 본문 */
  record MenuRequest(List<PurchaseLine> items) {}

  /** MI-01 응답 본문 (공통 응답 형식). 가격 필드는 Cooking에서 쓰지 않아 받지 않는다 */
  record MenuResponse(boolean success, Data data, String message, String errorCode) {}

  record Data(List<ValidatedMenu> items) {}
}
