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

  record ValidatedMenu(
      Long menuId, String menuName, int unitPrice, List<ValidatedOption> options) {}

  record ValidatedOption(Long optionId, String optionName, int extraPrice) {}
}
