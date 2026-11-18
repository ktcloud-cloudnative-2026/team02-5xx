package com.peakorder.order.messaging;

import com.peakorder.order.client.MenuClient.ValidatedMenu;
import com.peakorder.order.client.MenuClient.ValidatedOption;
import com.peakorder.order.entity.Order;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import java.util.stream.IntStream;

/**
 * Order → Cooking 이벤트(EV-01). 결제·재고 확정 후 조리 대기열 등록을 요청한다. 필드는 Cooking 담당자와 합의한 내용이다. 조리 시간은 Order
 * DB에 저장하지 않고, 결제 직전에 Menu(MI-01)에서 받아 이 이벤트에 담아 전달한다.
 */
public record OrderConfirmedEvent(
    UUID eventId,
    Long orderId,
    String orderNo,
    Long userId,
    OffsetDateTime confirmedAt,
    List<Item> items) {

  public static final String EVENT_TYPE = "OrderConfirmed";

  /** cookTimeSec: 메뉴 1개 조리 시간(초). */
  public record Item(
      Long menuId, String menuName, int quantity, int cookTimeSec, List<Option> options) {}

  /** extraCookTimeSec: 옵션으로 추가되는 조리 시간(초). */
  public record Option(Long optionId, String optionName, int extraCookTimeSec) {}

  /**
   * 주문 항목과 같은 순서의 Menu 응답(조리 시간 포함)으로 이벤트를 만든다. 조리 시간은 Order DB에 저장하지 않고 결제 시작 시 Menu에서 받은 값을 그대로
   * 싣는다.
   */
  public static OrderConfirmedEvent from(
      Order order, UUID eventId, OffsetDateTime confirmedAt, List<ValidatedMenu> menus) {
    if (menus == null || menus.size() != order.getItems().size()) {
      throw new IllegalArgumentException("주문 항목 수와 Menu 응답 수가 다릅니다.");
    }
    List<Item> items =
        IntStream.range(0, menus.size())
            .mapToObj(
                idx -> {
                  var item = order.getItems().get(idx);
                  ValidatedMenu menu = menus.get(idx);
                  List<Option> options =
                      item.getOptions().stream()
                          .map(
                              o ->
                                  new Option(
                                      o.getOptionId(),
                                      o.getOptionName(),
                                      extraCookTime(menu, o.getOptionId())))
                          .toList();
                  return new Item(
                      item.getMenuId(),
                      item.getMenuName(),
                      item.getQuantity(),
                      menu.cookTimeSec(),
                      options);
                })
            .toList();
    return new OrderConfirmedEvent(
        eventId, order.getId(), order.getOrderNo(), order.getUserId(), confirmedAt, items);
  }

  private static int extraCookTime(ValidatedMenu menu, Long optionId) {
    return menu.options().stream()
        .filter(o -> optionId.equals(o.optionId()))
        .map(ValidatedOption::extraCookTimeSec)
        .findFirst()
        .orElseThrow(() -> new IllegalArgumentException("Menu 응답에 옵션이 없습니다: " + optionId));
  }
}
