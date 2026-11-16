package com.peakorder.order.messaging;

import com.peakorder.order.entity.Order;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

/**
 * Order → Cooking 이벤트(EV-01). 결제·재고 확정 후 조리 대기열 등록을 요청한다. 필드는 초안이며 Cooking 담당자와 합의 후 확정한다. 조리 시간은
 * Order DB에 저장하지 않으므로 아직 포함하지 않았다(Menu 응답 확장 여부 결정 후 추가).
 */
public record OrderConfirmedEvent(
    UUID eventId,
    Long orderId,
    String orderNo,
    Long userId,
    OffsetDateTime confirmedAt,
    List<Item> items) {

  public static final String EVENT_TYPE = "OrderConfirmed";

  public record Item(Long menuId, String menuName, int quantity, List<Option> options) {}

  public record Option(Long optionId, String optionName) {}

  public static OrderConfirmedEvent from(Order order, UUID eventId, OffsetDateTime confirmedAt) {
    List<Item> items =
        order.getItems().stream()
            .map(
                i ->
                    new Item(
                        i.getMenuId(),
                        i.getMenuName(),
                        i.getQuantity(),
                        i.getOptions().stream()
                            .map(o -> new Option(o.getOptionId(), o.getOptionName()))
                            .toList()))
            .toList();
    return new OrderConfirmedEvent(
        eventId, order.getId(), order.getOrderNo(), order.getUserId(), confirmedAt, items);
  }
}
