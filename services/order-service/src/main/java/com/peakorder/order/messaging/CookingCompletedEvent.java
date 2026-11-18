package com.peakorder.order.messaging;

import java.time.OffsetDateTime;
import java.util.UUID;

/** Cooking → Order 이벤트(EV-02). 조리가 끝났음을 알린다. 필드는 초안이며 Cooking 담당자와 합의 후 확정한다. */
public record CookingCompletedEvent(UUID eventId, Long orderId, OffsetDateTime completedAt) {

  public static final String EVENT_TYPE = "CookingCompleted";
}
