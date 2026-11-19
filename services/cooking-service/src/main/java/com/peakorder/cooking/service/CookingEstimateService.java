package com.peakorder.cooking.service;

import com.peakorder.cooking.client.MenuClient;
import com.peakorder.cooking.client.MenuClient.PurchaseLine;
import com.peakorder.cooking.client.MenuClient.ValidatedMenu;
import com.peakorder.cooking.client.MenuClient.ValidatedOption;
import com.peakorder.cooking.dto.EstimateRequest;
import com.peakorder.cooking.dto.EstimateResponse;
import com.peakorder.cooking.exception.BusinessException;
import com.peakorder.cooking.exception.ErrorCode;
import java.util.HashSet;
import java.util.List;
import org.springframework.stereotype.Service;

/**
 * CO-02 주문 전 예상 시간.
 *
 * <ul>
 *   <li>조리 시간: Menu MI-01에서 받은 값으로 Σ((cookTimeSec + 옵션 extraCookTimeSec 합) × quantity). 클라이언트 값은 받지
 *       않는다(조작 방지)
 *   <li>대기 시간: CO-01과 같은 기준(순차 자동 조리)
 * </ul>
 *
 * <p>Menu HTTP 호출 동안 DB 트랜잭션을 잡지 않도록 이 클래스에는 트랜잭션을 두지 않는다.
 */
@Service
public class CookingEstimateService {

  private final MenuClient menuClient;
  private final CookingDashboardService dashboardService;

  public CookingEstimateService(MenuClient menuClient, CookingDashboardService dashboardService) {
    this.menuClient = menuClient;
    this.dashboardService = dashboardService;
  }

  public EstimateResponse estimate(EstimateRequest request) {
    List<PurchaseLine> lines =
        request.items().stream()
            .map(i -> new PurchaseLine(i.menuId(), i.quantity(), distinctOptionIds(i)))
            .toList();
    List<ValidatedMenu> menus = menuClient.validatePurchase(lines);

    long cookSec = 0;
    for (int i = 0; i < lines.size(); i++) {
      cookSec += unitCookSec(menus.get(i)) * lines.get(i).quantity();
    }
    long expectedWaitSec = dashboardService.getCongestion().expectedWaitSec();
    return new EstimateResponse(expectedWaitSec, cookSec, expectedWaitSec + cookSec);
  }

  /** 1개 조리 시간 = 기본 + 선택 옵션 추가 시간 (자동 조리의 cook_time_sec과 같은 기준) */
  private static long unitCookSec(ValidatedMenu menu) {
    return menu.cookTimeSec()
        + menu.options().stream().mapToLong(ValidatedOption::extraCookTimeSec).sum();
  }

  private static List<Long> distinctOptionIds(EstimateRequest.Item item) {
    List<Long> optionIds = item.optionIdsOrEmpty();
    if (new HashSet<>(optionIds).size() != optionIds.size()) {
      throw new BusinessException(ErrorCode.INVALID_REQUEST); // MI-01도 중복 옵션을 거절한다
    }
    return optionIds;
  }
}
