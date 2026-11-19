package com.peakorder.cooking.service;

import com.peakorder.cooking.dto.CookingQueueResponse;
import com.peakorder.cooking.dto.CookingStatusResponse;
import com.peakorder.cooking.entity.CookingTicket;
import com.peakorder.cooking.entity.TicketStatus;
import com.peakorder.cooking.exception.BusinessException;
import com.peakorder.cooking.exception.ErrorCode;
import com.peakorder.cooking.repository.CookingTicketRepository;
import java.time.Clock;
import java.time.Instant;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 조리 상태 조회.
 *
 * <p>예상 시간 계산 가정(명세에 계산식 없음): 조리대 1개에서 FIFO 순서로 한 건씩 조리한다. CI-02의 expectedWaitSec는 CO-01·CO-02처럼 조리
 * 시작까지, expectedReadySec는 조리 완료까지다(#139).
 *
 * <ul>
 *   <li>WAITING: 시작까지 = 조리 중 전표들의 남은 시간 합 + 내 앞 WAITING 전표들의 예상 조리 시간 합, 완료까지 = 시작까지 + 내 예상 조리 시간
 *   <li>COOKING: 시작까지 = 0, 완료까지 = max(0, 예상 조리 시간 − 조리 시작 후 경과 시간)
 *   <li>DONE·CANCELED: 둘 다 0
 * </ul>
 */
@Service
@Transactional(readOnly = true)
public class CookingQueryService {

  private final CookingTicketRepository ticketRepository;
  private final Clock clock;

  public CookingQueryService(CookingTicketRepository ticketRepository, Clock clock) {
    this.ticketRepository = ticketRepository;
    this.clock = clock;
  }

  /** CI-02. 전표가 없으면(EV-01 처리 전 포함) COOKING_TICKET_NOT_FOUND. */
  public CookingStatusResponse getStatus(Long orderId) {
    CookingTicket ticket =
        ticketRepository
            .findByOrderId(orderId)
            .orElseThrow(() -> new BusinessException(ErrorCode.COOKING_TICKET_NOT_FOUND));
    Instant now = clock.instant();

    return switch (ticket.getStatus()) {
      case WAITING -> {
        long ahead =
            ticketRepository.countAheadByStatus(
                TicketStatus.WAITING, ticket.getQueuedAt(), ticket.getId());
        long aheadCookSec =
            ticketRepository.sumEstimatedCookSecAheadByStatus(
                TicketStatus.WAITING, ticket.getQueuedAt(), ticket.getId());
        long waitSec = cookingRemainingSec(now) + aheadCookSec;
        yield CookingStatusResponse.of(
            ticket, ahead, waitSec, waitSec + ticket.getEstimatedCookSec());
      }
      case COOKING -> CookingStatusResponse.of(ticket, 0, 0, remainingSec(ticket, now));
      case DONE, CANCELED -> CookingStatusResponse.of(ticket, 0, 0, 0);
    };
  }

  /** CO-04. WAITING 전표를 Cooking DB 등록 순서(FIFO)로 조회한다. */
  public CookingQueueResponse getQueue() {
    return CookingQueueResponse.from(
        ticketRepository.findByStatusOrderByQueuedAtAscIdAsc(TicketStatus.WAITING));
  }

  /** 현재 조리 중인 전표들의 남은 시간 합(초) */
  private long cookingRemainingSec(Instant now) {
    return CookingTimes.remainingSec(
        ticketRepository.findByStatusOrderByQueuedAtAscIdAsc(TicketStatus.COOKING), now);
  }

  private static long remainingSec(CookingTicket ticket, Instant now) {
    return CookingTimes.remainingSec(ticket, now);
  }
}
