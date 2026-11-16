package com.peakorder.order.client;

import java.time.OffsetDateTime;
import java.util.List;

/**
 * Inventory Service 내부 API 호출. 요청·응답 필드는 초안이며 Inventory 담당자와 합의 후 확정한다.
 *
 * <ul>
 *   <li>II-01 POST /internal/v1/inventory/holds
 *   <li>II-02 POST /internal/v1/inventory/holds/{holdId}/confirm
 *   <li>II-03 DELETE /internal/v1/inventory/holds/{holdId}
 * </ul>
 */
public interface InventoryClient {

  /** orderId 기준으로 재고를 임시 확보한다. 같은 orderId의 중복 요청은 Inventory가 방지한다. */
  StockHold hold(Long orderId, List<HoldLine> lines);

  /**
   * 임시 확보한 재고를 확정 차감한다. 이미 확정된 요청은 Inventory가 중복 차감하지 않는다.
   *
   * @throws com.peakorder.order.exception.BusinessException 확정할 수 없음이 확실하면 STOCK_CONFIRM_FAILED,
   *     결과를 알 수 없으면 INVENTORY_SERVICE_UNAVAILABLE
   */
  void confirm(Long holdId);

  /** 임시 확보한 재고를 반환한다. 이미 해제한 재고는 Inventory가 중복 반환하지 않는다. */
  void release(Long holdId);

  record HoldLine(Long menuId, int quantity) {}

  record StockHold(Long holdId, OffsetDateTime expiresAt) {}
}
