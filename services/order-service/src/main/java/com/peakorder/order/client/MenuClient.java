package com.peakorder.order.client;

import java.util.List;

/**
 * Menu Service 내부 API 호출 (MI-01 POST /internal/v1/menus/validate-purchase). 요청·응답 필드는 초안이며 Menu
 * 담당자와 합의 후 확정한다.
 */
public interface MenuClient {

  /** 요청 항목 순서와 같은 순서로 검증 결과를 돌려준다. */
  List<ValidatedMenu> validatePurchase(List<PurchaseLine> lines);

  record PurchaseLine(Long menuId, int quantity, List<Long> optionIds) {}

  /**
   * cookTimeSec: 메뉴 1개 조리 시간(초). 주문 생성(OR-01)에서는 쓰지 않고, 결제(OR-02)에서 OrderConfirmed에 담을 때 필요하다.
   * Menu가 이 필드를 내려주도록 합의가 필요하다.
   */
  record ValidatedMenu(
      Long menuId,
      String menuName,
      int unitPrice,
      Integer cookTimeSec,
      List<ValidatedOption> options) {

    public ValidatedMenu(
        Long menuId, String menuName, int unitPrice, List<ValidatedOption> options) {
      this(menuId, menuName, unitPrice, null, options);
    }
  }

  /** extraCookTimeSec: 옵션 선택 시 추가되는 조리 시간(초). */
  record ValidatedOption(
      Long optionId, String optionName, int extraPrice, Integer extraCookTimeSec) {

    public ValidatedOption(Long optionId, String optionName, int extraPrice) {
      this(optionId, optionName, extraPrice, null);
    }
  }
}
