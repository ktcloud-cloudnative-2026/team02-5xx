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
    List<Item> items,
    CookingInfo cooking) {

  public record Item(
      Long menuId,
      String menuName,
      int unitPrice,
      int quantity,
      int lineAmount,
      List<Option> options) {}

  public record Option(Long optionId, String optionName, int extraPrice) {}

  /** Cooking 조회 결과. OK가 아니면 조리 정보 필드는 모두 생략한다. */
  public enum Lookup {
    /** 조리 정보를 받았다. */
    OK,
    /** 결제 후 조리 전표 등록을 기다리는 중이다(Cooking 404). */
    PENDING,
    /** Cooking 장애·시간 초과·계약과 다른 응답으로 지금은 알 수 없다. */
    UNAVAILABLE
  }

  /**
   * 주문 상세의 조리 상태(CI-02).
   *
   * @param expectedWaitSec 지금부터 조리 시작까지 예상 시간(초). 대기 중이 아니면 0
   * @param expectedReadySec 지금부터 조리 완료까지 예상 시간(초). 조리 중에는 남은 시간, 완료·취소는 0
   */
  @JsonInclude(JsonInclude.Include.NON_NULL)
  public record CookingInfo(
      Lookup lookup,
      String status,
      Long waitingAhead,
      Integer estimatedCookSec,
      Long expectedWaitSec,
      Long expectedReadySec,
      OffsetDateTime startedAt) {

    /** 조리 시작 시각은 다른 시각 필드처럼 KST로 내린다. */
    public static CookingInfo ok(
        String status,
        long waitingAhead,
        int estimatedCookSec,
        long expectedWaitSec,
        long expectedReadySec,
        OffsetDateTime startedAt) {
      return new CookingInfo(
          Lookup.OK,
          status,
          waitingAhead,
          estimatedCookSec,
          expectedWaitSec,
          expectedReadySec,
          kst(startedAt));
    }

    public static CookingInfo pending() {
      return new CookingInfo(Lookup.PENDING, null, null, null, null, null, null);
    }

    public static CookingInfo unavailable() {
      return new CookingInfo(Lookup.UNAVAILABLE, null, null, null, null, null, null);
    }
  }

  public OrderDetailResponse withCooking(CookingInfo cooking) {
    return new OrderDetailResponse(
        orderId,
        orderNo,
        status,
        totalAmount,
        expectedWaitSec,
        orderedAt,
        paidAt,
        canceledAt,
        completedAt,
        holdExpiresAt,
        items,
        cooking);
  }

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
        items,
        null);
  }

  static OffsetDateTime kst(OffsetDateTime time) {
    return time == null ? null : time.atZoneSameInstant(ClockConfig.ZONE).toOffsetDateTime();
  }
}
