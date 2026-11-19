package com.peakorder.cooking.client;

import java.util.List;

/** Menu 내부 API 호출 (MI-01 구매 검증 — #86 A안, Order와 공통 사용) */
public interface MenuClient {

  /**
   * 메뉴·옵션의 판매 가능 여부를 확인하고 조리 시간을 받는다. 요청 항목 순서와 같은 순서로 돌려준다.
   *
   * @throws com.peakorder.cooking.exception.BusinessException MENU_NOT_AVAILABLE(Menu 4xx),
   *     MENU_SERVICE_UNAVAILABLE(장애·타임아웃), UPSTREAM_INVALID_RESPONSE(형식 불일치)
   */
  List<ValidatedMenu> validatePurchase(List<PurchaseLine> lines);

  /** optionIds는 옵션이 없어도 빈 목록 (MI-01은 배열 필수) */
  record PurchaseLine(Long menuId, int quantity, List<Long> optionIds) {}

  /**
   * cookTimeSec: 메뉴 1개 기본 조리 시간(초). 응답에서 빠지면 0으로 읽히지 않도록 Integer로 받아 HttpMenuClient가 null을 거절한다.
   */
  record ValidatedMenu(
      Long menuId, String menuName, Integer cookTimeSec, List<ValidatedOption> options) {}

  /** extraCookTimeSec: 옵션 선택 시 1개당 추가 조리 시간(초). 누락 검사를 위해 Integer */
  record ValidatedOption(Long optionId, String optionName, Integer extraCookTimeSec) {}
}
