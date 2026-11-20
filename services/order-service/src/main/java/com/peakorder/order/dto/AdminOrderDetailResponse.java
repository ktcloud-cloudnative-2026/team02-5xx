package com.peakorder.order.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.peakorder.order.dto.OrderDetailResponse.Item;
import com.peakorder.order.dto.OrderDetailResponse.Option;
import com.peakorder.order.entity.Order;
import com.peakorder.order.entity.OrderStatus;
import java.time.OffsetDateTime;
import java.util.List;

/**
 * 관리자 주문 상세(OR-09). 고객용 상세(OR-04)에 결제·취소·후속 처리 정보를 더한다.
 *
 * @param manualReviewRequired 환불·재고 복원이 자동 재시도로 풀리지 않아 사람이 확인해야 하는 주문인가
 * @param manualReviewReason 이유 코드(예: REFUND_NOT_REFUNDABLE, RESTORE_NOT_APPLICABLE,
 *     RETRY_LIMIT_EXCEEDED)
 * @param cancelRequestedAt Cooking에 취소를 요청한 시각(응답을 모르면 남아 있어 "취소 처리 중"일 수 있다)
 * @param refundedAt 취소 후 환불을 끝낸 시각(없으면 아직 안 끝남 또는 환불 대상 아님)
 * @param stockRestoredAt 취소 후 재고 복원을 끝낸 시각
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record AdminOrderDetailResponse(
    Long orderId,
    String orderNo,
    Long userId,
    OrderStatus status,
    int totalAmount,
    OffsetDateTime orderedAt,
    OffsetDateTime paidAt,
    OffsetDateTime canceledAt,
    OffsetDateTime completedAt,
    String cancelReason,
    String failReason,
    Long paymentId,
    OffsetDateTime cancelRequestedAt,
    OffsetDateTime stockRestoredAt,
    OffsetDateTime refundedAt,
    boolean manualReviewRequired,
    String manualReviewReason,
    int cancelFollowUpAttempts,
    List<Item> items) {

  public static AdminOrderDetailResponse from(Order order) {
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
    boolean manual = order.needsManualReview();
    return new AdminOrderDetailResponse(
        order.getId(),
        order.getOrderNo(),
        order.getUserId(),
        order.getStatus(),
        order.getTotalAmount(),
        OrderDetailResponse.kst(order.getOrderedAt()),
        OrderDetailResponse.kst(order.getPaidAt()),
        OrderDetailResponse.kst(order.getCanceledAt()),
        OrderDetailResponse.kst(order.getCompletedAt()),
        order.getCancelReason(),
        order.getFailReason(),
        order.getPaymentId(),
        OrderDetailResponse.kst(order.getCancelRequestedAt()),
        OrderDetailResponse.kst(order.getStockRestoredAt()),
        OrderDetailResponse.kst(order.getRefundedAt()),
        manual,
        manual ? order.getCancelFollowUpManualReason() : null,
        order.getCancelFollowUpAttempts(),
        items);
  }
}
