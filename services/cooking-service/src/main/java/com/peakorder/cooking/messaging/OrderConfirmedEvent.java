package com.peakorder.cooking.messaging;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

/**
 * Order → Cooking 이벤트(EV-01). 결제·재고 확정이 끝난 주문을 조리 대기열에 등록한다. 필드는 Order #51과 합의한 계약을 따른다.
 *
 * <p>userId, confirmedAt은 저장하지 않는다(queued_at은 Cooking 등록 시각을 쓴다).
 */
public record OrderConfirmedEvent(
    UUID eventId,
    Long orderId,
    String orderNo,
    Long userId,
    OffsetDateTime confirmedAt,
    List<Item> items) {

  public static final String EVENT_TYPE = "OrderConfirmed";

  /** cookTimeSec: 메뉴 1개 기본 조리 시간(초, 옵션 제외) */
  public record Item(
      Long menuId, String menuName, int quantity, int cookTimeSec, List<Option> options) {}

  /** extraCookTimeSec: 옵션으로 추가되는 1개당 조리 시간(초) */
  public record Option(Long optionId, String optionName, int extraCookTimeSec) {}
}
