package com.peakorder.cooking.service;

import com.peakorder.cooking.config.ClockConfig;
import com.peakorder.cooking.dto.CongestionResponse;
import com.peakorder.cooking.dto.CookingOverviewResponse;
import com.peakorder.cooking.entity.CongestionThreshold;
import com.peakorder.cooking.entity.CookingTicket;
import com.peakorder.cooking.entity.TicketStatus;
import com.peakorder.cooking.repository.CongestionThresholdRepository;
import com.peakorder.cooking.repository.CookingTicketRepository;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 혼잡도(CO-01)·조리 현황(CO-03) 조회. cooking_tickets 상태로 바로 계산한다(Redis 캐시는 기술 스택 결정 후 별도 적용).
 *
 * <p>예상 대기 = 조리 중 남은 시간 + 대기 중 전표들의 예상 조리 시간 합 (지금 주문하면 조리 시작까지, {@link CookingTimes}). 혼잡 기준은
 * congestion_thresholds.busy_wait_sec, 행이 없으면 설정 기본값을 쓴다.
 */
@Service
@Transactional(readOnly = true)
public class CookingDashboardService {

  private final CookingTicketRepository ticketRepository;
  private final CongestionThresholdRepository thresholdRepository;
  private final Clock clock;
  private final int defaultBusyWaitSec;

  public CookingDashboardService(
      CookingTicketRepository ticketRepository,
      CongestionThresholdRepository thresholdRepository,
      Clock clock,
      @Value("${cooking.congestion.default-busy-wait-sec:600}") int defaultBusyWaitSec) {
    this.ticketRepository = ticketRepository;
    this.thresholdRepository = thresholdRepository;
    this.clock = clock;
    this.defaultBusyWaitSec = defaultBusyWaitSec;
  }

  /** CO-01 */
  public CongestionResponse getCongestion() {
    Instant now = clock.instant();
    List<CookingTicket> cooking = cookingTickets();
    long waitingCount = ticketRepository.countByStatus(TicketStatus.WAITING);
    long expectedWaitSec = expectedWaitSec(cooking, now);
    CongestionResponse.Level level =
        expectedWaitSec >= busyWaitSec()
            ? CongestionResponse.Level.CROWDED
            : CongestionResponse.Level.NORMAL;
    return new CongestionResponse(level, waitingCount, cooking.size(), expectedWaitSec);
  }

  /** CO-03 */
  public CookingOverviewResponse getOverview() {
    Instant now = clock.instant();
    Instant startOfToday = LocalDate.now(clock).atStartOfDay(ClockConfig.ZONE).toInstant();
    List<CookingTicket> cooking = cookingTickets();
    return new CookingOverviewResponse(
        ticketRepository.countByStatus(TicketStatus.WAITING),
        cooking.size(),
        ticketRepository.countByStatusAndCompletedAtGreaterThanEqual(
            TicketStatus.DONE, startOfToday),
        ticketRepository.countByStatusAndCanceledAtGreaterThanEqual(
            TicketStatus.CANCELED, startOfToday),
        cooking.isEmpty() ? null : cooking.get(0).getOrderNo(),
        expectedWaitSec(cooking, now));
  }

  private List<CookingTicket> cookingTickets() {
    return ticketRepository.findByStatusOrderByQueuedAtAscIdAsc(TicketStatus.COOKING);
  }

  /**
   * 지금 주문하면 조리 시작까지 예상 대기(초). CO-01과 같은 계산 — 지표 {@code cooking_expected_wait_seconds}(#243)가 재사용한다.
   */
  public long expectedWaitSec() {
    return expectedWaitSec(cookingTickets(), clock.instant());
  }

  private long expectedWaitSec(List<CookingTicket> cooking, Instant now) {
    return CookingTimes.remainingSec(cooking, now)
        + ticketRepository.sumEstimatedCookSecByStatus(TicketStatus.WAITING);
  }

  private int busyWaitSec() {
    return thresholdRepository
        .findFirstByOrderByIdAsc()
        .map(CongestionThreshold::getBusyWaitSec)
        .orElse(defaultBusyWaitSec);
  }
}
