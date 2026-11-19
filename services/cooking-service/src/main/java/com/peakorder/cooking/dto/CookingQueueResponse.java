package com.peakorder.cooking.dto;

import com.peakorder.cooking.entity.CookingTicket;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.stream.IntStream;

/**
 * CO-04 FIFO 대기열 응답. WAITING 전표를 Cooking DB 등록 순서(queued_at, id)로 나열한다.
 *
 * @param count 대기 건수
 * @param items 대기 전표 목록 (position 1이 다음 조리 대상)
 */
public record CookingQueueResponse(int count, List<Entry> items) {

  public record Entry(
      int position, Long orderId, String orderNo, OffsetDateTime queuedAt, int estimatedCookSec) {}

  /**
   * @param fifoTickets 이미 FIFO 순으로 정렬된 WAITING 전표
   */
  public static CookingQueueResponse from(List<CookingTicket> fifoTickets) {
    List<Entry> items =
        IntStream.range(0, fifoTickets.size())
            .mapToObj(i -> {
              CookingTicket t = fifoTickets.get(i);
              return new Entry(
                  i + 1,
                  t.getOrderId(),
                  t.getOrderNo(),
                  CookingStatusResponse.kst(t.getQueuedAt()),
                  t.getEstimatedCookSec());
            })
            .toList();
    return new CookingQueueResponse(items.size(), items);
  }
}
