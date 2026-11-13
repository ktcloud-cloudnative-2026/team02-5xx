package com.peakorder.order.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.peakorder.order.entity.Order;
import com.peakorder.order.entity.OrderItem;
import com.peakorder.order.entity.OrderStatus;
import java.time.OffsetDateTime;

@JsonInclude(JsonInclude.Include.NON_NULL)
public record OrderSummaryResponse(
    Long orderId,
    String orderNo,
    OrderStatus status,
    int totalAmount,
    OffsetDateTime orderedAt,
    int itemCount,
    String representativeMenuName) {

  public static OrderSummaryResponse from(Order order) {
    String name = order.getItems().stream().findFirst().map(OrderItem::getMenuName).orElse(null);
    return new OrderSummaryResponse(
        order.getId(),
        order.getOrderNo(),
        order.getStatus(),
        order.getTotalAmount(),
        OrderDetailResponse.kst(order.getOrderedAt()),
        order.getItems().size(),
        name);
  }
}
