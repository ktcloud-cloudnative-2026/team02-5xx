package com.peakorder.order.dto;

import com.peakorder.order.config.ClockConfig;
import com.peakorder.order.entity.StoreOperation;
import java.time.OffsetDateTime;

/** OR-06·OR-07 응답. 영업 여부와 주문 접수 여부, 마지막 변경 시각. */
public record StoreOperationResponse(
    boolean isOpen, boolean acceptingOrders, OffsetDateTime updatedAt) {

  public static StoreOperationResponse from(StoreOperation store) {
    return new StoreOperationResponse(
        store.isOpen(),
        store.isAcceptingOrders(),
        store.getUpdatedAt() == null
            ? null
            : store.getUpdatedAt().atZoneSameInstant(ClockConfig.ZONE).toOffsetDateTime());
  }
}
