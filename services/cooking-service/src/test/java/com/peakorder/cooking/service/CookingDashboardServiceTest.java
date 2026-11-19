package com.peakorder.cooking.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.peakorder.cooking.config.ClockConfig;
import com.peakorder.cooking.dto.CongestionResponse;
import com.peakorder.cooking.dto.CookingOverviewResponse;
import com.peakorder.cooking.entity.CongestionThreshold;
import com.peakorder.cooking.entity.CookingTicket;
import com.peakorder.cooking.entity.CookingTicketItem;
import com.peakorder.cooking.entity.TicketStatus;
import com.peakorder.cooking.repository.CongestionThresholdRepository;
import com.peakorder.cooking.repository.CookingTicketRepository;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class CookingDashboardServiceTest {

  /** KST 2026-11-17 10:00 */
  private static final Instant NOW = Instant.parse("2026-11-17T01:00:00Z");

  /** KST 2026-11-17 00:00 */
  private static final Instant START_OF_TODAY_KST = Instant.parse("2026-11-16T15:00:00Z");

  private CookingTicketRepository ticketRepository;
  private CongestionThresholdRepository thresholdRepository;
  private CookingDashboardService service;

  @BeforeEach
  void setUp() {
    ticketRepository = mock(CookingTicketRepository.class);
    thresholdRepository = mock(CongestionThresholdRepository.class);
    service =
        new CookingDashboardService(
            ticketRepository, thresholdRepository, Clock.fixed(NOW, ClockConfig.ZONE), 600);
  }

  /** 300초짜리 전표를 100초 전에 시작 → 남은 200초 */
  private void givenCookingRemaining200Sec() {
    CookingTicket cooking =
        CookingTicket.create(
            1L, "261117-0001", List.of(CookingTicketItem.of(1L, "버거", null, 1, 300)));
    cooking.start(NOW.minusSeconds(100));
    when(ticketRepository.findByStatusOrderByQueuedAtAscIdAsc(TicketStatus.COOKING))
        .thenReturn(List.of(cooking));
  }

  private void givenWaiting(long count, long totalCookSec) {
    when(ticketRepository.countByStatus(TicketStatus.WAITING)).thenReturn(count);
    when(ticketRepository.sumEstimatedCookSecByStatus(TicketStatus.WAITING))
        .thenReturn(totalCookSec);
  }

  @Test
  void 예상_대기는_조리중_남은시간과_대기_전체_조리시간의_합이다() {
    givenCookingRemaining200Sec();
    givenWaiting(2, 250);

    CongestionResponse res = service.getCongestion();

    assertThat(res.waitingCount()).isEqualTo(2);
    assertThat(res.cookingCount()).isEqualTo(1);
    assertThat(res.expectedWaitSec()).isEqualTo(450);
    assertThat(res.level()).isEqualTo(CongestionResponse.Level.NORMAL); // 기본 기준 600초 미만
  }

  @Test
  void 기준값이_있으면_그_값으로_판단하고_같으면_혼잡이다() {
    givenCookingRemaining200Sec();
    givenWaiting(2, 250); // 450초
    when(thresholdRepository.findFirstByOrderByIdAsc())
        .thenReturn(Optional.of(CongestionThreshold.of(450, NOW)));

    assertThat(service.getCongestion().level()).isEqualTo(CongestionResponse.Level.CROWDED);
  }

  @Test
  void 기준값이_없으면_기본값으로_판단한다() {
    when(ticketRepository.findByStatusOrderByQueuedAtAscIdAsc(TicketStatus.COOKING))
        .thenReturn(List.of());
    givenWaiting(5, 600); // 600초 = 기본 기준

    CongestionResponse res = service.getCongestion();

    assertThat(res.expectedWaitSec()).isEqualTo(600);
    assertThat(res.level()).isEqualTo(CongestionResponse.Level.CROWDED);
  }

  @Test
  void 현황은_오늘_KST_0시_이후_완료_취소_건수와_조리중_주문번호를_보여준다() {
    givenCookingRemaining200Sec();
    givenWaiting(3, 100);
    when(ticketRepository.countByStatusAndCompletedAtGreaterThanEqual(
            eq(TicketStatus.DONE), eq(START_OF_TODAY_KST)))
        .thenReturn(12L);
    when(ticketRepository.countByStatusAndCanceledAtGreaterThanEqual(
            eq(TicketStatus.CANCELED), eq(START_OF_TODAY_KST)))
        .thenReturn(1L);

    CookingOverviewResponse res = service.getOverview();

    assertThat(res).isEqualTo(new CookingOverviewResponse(3, 1, 12, 1, "261117-0001", 200 + 100));
  }

  @Test
  void 조리중인_주문이_없으면_주문번호는_비어있다() {
    when(ticketRepository.findByStatusOrderByQueuedAtAscIdAsc(TicketStatus.COOKING))
        .thenReturn(List.of());
    givenWaiting(0, 0);

    CookingOverviewResponse res = service.getOverview();

    assertThat(res.cookingOrderNo()).isNull();
    assertThat(res.expectedWaitSec()).isZero();
  }
}
