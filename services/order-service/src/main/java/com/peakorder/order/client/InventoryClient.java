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

  /**
   * 취소할 때 임시 확보를 해제한다(II-03). 이미 만료·해제된 확보도 성공(200)이고, 확정된 확보(409)는 {@link
   * HoldRelease#ALREADY_CONFIRMED}로 알린다.
   *
   * @throws com.peakorder.order.exception.BusinessException 결과를 알 수 없으면
   *     INVENTORY_SERVICE_UNAVAILABLE, 계약과 다른 응답이면 UPSTREAM_INVALID_RESPONSE
   */
  HoldRelease releaseHold(Long holdId);

  /**
   * 확정된 주문을 취소할 때 재고를 복원한다(II-04, 본문 {@code {"orderId": …}}). 같은 주문의 중복 복원은 Inventory가 막고 200으로
   * 응답한다.
   *
   * @throws com.peakorder.order.exception.BusinessException 결과를 알 수 없으면
   *     INVENTORY_SERVICE_UNAVAILABLE, 계약과 다른 응답이면 UPSTREAM_INVALID_RESPONSE
   */
  RestoreResult restore(Long orderId);

  enum HoldRelease {
    /** 200: 해제됐거나 이미 만료·해제돼 반환할 재고가 없다. */
    RELEASED,
    /** 409: 이미 확정(차감)된 확보라 해제할 수 없다. 결제 기록 없이 확정된 이상 상태다. */
    ALREADY_CONFIRMED
  }

  enum RestoreResult {
    /** 200: 복원됐거나 이미 복원됐다. */
    RESTORED,
    /** 409 RESTORE_NOT_APPLICABLE: 복원할 수 없는 주문. 성공으로 보지 않는다. */
    NOT_APPLICABLE
  }

  record HoldLine(Long menuId, int quantity) {}

  record StockHold(Long holdId, OffsetDateTime expiresAt) {}
}
