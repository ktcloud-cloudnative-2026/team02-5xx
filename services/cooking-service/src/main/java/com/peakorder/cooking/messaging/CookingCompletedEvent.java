package com.peakorder.cooking.messaging;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * Cooking → Order 이벤트(EV-02). 조리가 끝났음을 알린다. 필드는 Order #52와 합의한 계약을 따른다.
 *
 * @param completedAt 조리 완료 시각 (ISO 8601, +09:00)
 */
public record CookingCompletedEvent(UUID eventId, Long orderId, OffsetDateTime completedAt) {

  public static final String EVENT_TYPE = "CookingCompleted";
}
