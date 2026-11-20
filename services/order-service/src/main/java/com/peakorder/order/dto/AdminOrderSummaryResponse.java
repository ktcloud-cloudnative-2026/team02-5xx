package com.peakorder.order.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.peakorder.order.entity.Order;
import com.peakorder.order.entity.OrderItem;
import com.peakorder.order.entity.OrderStatus;
import java.time.OffsetDateTime;

/** 관리자 주문 목록(OR-08)의 한 줄. 사용자는 ID만 담는다(Order는 이름·연락처를 갖지 않는다). */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record AdminOrderSummaryResponse(
    Long orderId,
    String orderNo,
    Long userId,
    OrderStatus status,
    int totalAmount,
    OffsetDateTime orderedAt,
    OffsetDateTime canceledAt,
    int itemCount,
    String representativeMenuName,
    boolean manualReviewRequired) {

  public static AdminOrderSummaryResponse from(Order order) {
    String name = order.getItems().stream().findFirst().map(OrderItem::getMenuName).orElse(null);
    return new AdminOrderSummaryResponse(
        order.getId(),
        order.getOrderNo(),
        order.getUserId(),
        order.getStatus(),
        order.getTotalAmount(),
        OrderDetailResponse.kst(order.getOrderedAt()),
        OrderDetailResponse.kst(order.getCanceledAt()),
        order.getItems().size(),
        name,
        order.needsManualReview());
  }
}
