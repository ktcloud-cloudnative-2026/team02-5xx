package com.peakorder.cooking.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.peakorder.cooking.config.ClockConfig;
import com.peakorder.cooking.entity.CookingTicket;
import com.peakorder.cooking.entity.TicketStatus;
import java.time.Instant;
import java.time.OffsetDateTime;

/**
 * CI-02 주문별 조리 상태·예상시간 응답.
 *
 * @param waitingAhead FIFO 기준 내 앞에 있는 WAITING 전표 수 (WAITING일 때만 의미 있음, 그 외 0)
 * @param estimatedCookSec 이 주문 자체의 예상 조리 시간(초)
 * @param expectedWaitSec 지금부터 이 주문의 조리 완료까지 예상 시간(초). DONE·CANCELED는 0
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record CookingStatusResponse(
    Long orderId,
    String orderNo,
    TicketStatus status,
    long waitingAhead,
    int estimatedCookSec,
    long expectedWaitSec,
    OffsetDateTime queuedAt,
    OffsetDateTime startedAt,
    OffsetDateTime completedAt,
    OffsetDateTime canceledAt) {

  public static CookingStatusResponse of(
      CookingTicket ticket, long waitingAhead, long expectedWaitSec) {
    return new CookingStatusResponse(
        ticket.getOrderId(),
        ticket.getOrderNo(),
        ticket.getStatus(),
        waitingAhead,
        ticket.getEstimatedCookSec(),
        expectedWaitSec,
        kst(ticket.getQueuedAt()),
        kst(ticket.getStartedAt()),
        kst(ticket.getCompletedAt()),
        kst(ticket.getCanceledAt()));
  }

  static OffsetDateTime kst(Instant time) {
    return time == null ? null : time.atZone(ClockConfig.ZONE).toOffsetDateTime();
  }
}
