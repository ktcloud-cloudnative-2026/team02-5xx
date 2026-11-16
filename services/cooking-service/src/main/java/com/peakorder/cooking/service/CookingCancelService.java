package com.peakorder.cooking.service;

import com.peakorder.cooking.dto.CookingCancelResponse;
import com.peakorder.cooking.entity.CookingTicket;
import com.peakorder.cooking.exception.BusinessException;
import com.peakorder.cooking.exception.ErrorCode;
import com.peakorder.cooking.repository.CookingTicketRepository;
import java.time.Clock;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * CI-03 주문 취소. 취소 가능 여부는 Cooking이 최종 판단한다(아키텍처 4.2).
 *
 * <p>전표를 행 잠금으로 조회한 뒤 상태를 확인하므로, 자동 조리 시작과 동시에 일어나도 먼저 잠근 쪽만 성공한다.
 *
 * <ul>
 *   <li>WAITING → CANCELED, 200
 *   <li>이미 CANCELED → 같은 200 (멱등: Order가 결과 불명 시 재요청)
 *   <li>COOKING → 409 COOKING_ALREADY_STARTED, DONE → 409 COOKING_ALREADY_DONE
 *   <li>전표 없음(OrderConfirmed 처리 전 포함) → 404 COOKING_TICKET_NOT_FOUND
 * </ul>
 */
@Service
public class CookingCancelService {

  private static final Logger log = LoggerFactory.getLogger(CookingCancelService.class);

  private final CookingTicketRepository ticketRepository;
  private final Clock clock;

  public CookingCancelService(CookingTicketRepository ticketRepository, Clock clock) {
    this.ticketRepository = ticketRepository;
    this.clock = clock;
  }

  @Transactional
  public CookingCancelResponse cancel(Long orderId) {
    CookingTicket ticket =
        ticketRepository
            .findWithLockByOrderId(orderId)
            .orElseThrow(() -> new BusinessException(ErrorCode.COOKING_TICKET_NOT_FOUND));

    switch (ticket.getStatus()) {
      case WAITING -> {
        ticket.cancel(clock.instant());
        log.info("조리 대기 주문을 취소했습니다 orderId={}", orderId);
      }
      case CANCELED -> log.info("이미 취소된 주문의 취소 재요청입니다 orderId={}", orderId);
      case COOKING -> throw new BusinessException(ErrorCode.COOKING_ALREADY_STARTED);
      case DONE -> throw new BusinessException(ErrorCode.COOKING_ALREADY_DONE);
    }
    return CookingCancelResponse.from(ticket);
  }
}
