package com.peakorder.order.client;

import java.time.OffsetDateTime;
import java.util.List;

/**
 * Inventory Service 내부 API 호출 (II-01 POST /internal/v1/inventory/holds). 요청·응답 필드는 초안이며 Inventory
 * 담당자와 합의 후 확정한다.
 */
public interface InventoryClient {

  /** orderId 기준으로 재고를 임시 확보한다. 같은 orderId의 중복 요청은 Inventory가 방지한다. */
  StockHold hold(Long orderId, List<HoldLine> lines);

  record HoldLine(Long menuId, int quantity) {}

  record StockHold(Long holdId, OffsetDateTime expiresAt) {}
}
