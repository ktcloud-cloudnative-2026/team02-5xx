package com.peakorder.order.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.peakorder.order.config.ClockConfig;
import com.peakorder.order.entity.Order;
import com.peakorder.order.entity.OrderStatus;
import java.time.OffsetDateTime;
import java.util.List;

@JsonInclude(JsonInclude.Include.NON_NULL)
public record OrderDetailResponse(
    Long orderId,
    String orderNo,
    OrderStatus status,
    int totalAmount,
    Integer expectedWaitSec,
    OffsetDateTime orderedAt,
    OffsetDateTime paidAt,
    OffsetDateTime canceledAt,
    OffsetDateTime completedAt,
    OffsetDateTime holdExpiresAt,
    List<Item> items) {

  public record Item(
      Long menuId,
      String menuName,
      int unitPrice,
      int quantity,
      int lineAmount,
      List<Option> options) {}

  public record Option(Long optionId, String optionName, int extraPrice) {}

  /** 확보 만료 시각은 결제 전(CREATED) 주문에만 노출한다. */
  public static OrderDetailResponse from(Order order) {
    List<Item> items =
        order.getItems().stream()
            .map(
                i ->
                    new Item(
                        i.getMenuId(),
                        i.getMenuName(),
                        i.getUnitPrice(),
                        i.getQuantity(),
                        i.getLineAmount(),
                        i.getOptions().stream()
                            .map(
                                o ->
                                    new Option(
                                        o.getOptionId(), o.getOptionName(), o.getExtraPrice()))
                            .toList()))
            .toList();
    OffsetDateTime holdExpiresAt =
        order.getStatus() == OrderStatus.CREATED ? kst(order.getHoldExpiresAt()) : null;
    return new OrderDetailResponse(
        order.getId(),
        order.getOrderNo(),
        order.getStatus(),
        order.getTotalAmount(),
        order.getExpectedWaitSec(),
        kst(order.getOrderedAt()),
        kst(order.getPaidAt()),
        kst(order.getCanceledAt()),
        kst(order.getCompletedAt()),
        holdExpiresAt,
        items);
  }

  static OffsetDateTime kst(OffsetDateTime time) {
    return time == null ? null : time.atZoneSameInstant(ClockConfig.ZONE).toOffsetDateTime();
  }
}
