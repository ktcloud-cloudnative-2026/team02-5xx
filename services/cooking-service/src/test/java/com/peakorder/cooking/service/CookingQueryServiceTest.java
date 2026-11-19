package com.peakorder.cooking.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.tuple;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.peakorder.cooking.config.ClockConfig;
import com.peakorder.cooking.dto.CookingQueueResponse;
import com.peakorder.cooking.dto.CookingStatusResponse;
import com.peakorder.cooking.entity.CookingTicket;
import com.peakorder.cooking.entity.CookingTicketItem;
import com.peakorder.cooking.entity.TicketStatus;
import com.peakorder.cooking.exception.BusinessException;
import com.peakorder.cooking.exception.ErrorCode;
import com.peakorder.cooking.repository.CookingTicketRepository;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

class CookingQueryServiceTest {

  private static final Instant NOW = Instant.parse("2026-11-16T01:00:00Z");

  private CookingTicketRepository repository;
  private CookingQueryService service;

  @BeforeEach
  void setUp() {
    repository = mock(CookingTicketRepository.class);
    service = new CookingQueryService(repository, Clock.fixed(NOW, ClockConfig.ZONE));
  }

  /** 예상 조리 시간 = cookTimeSec × quantity */
  /** queuedAt은 저장 시 DB가 정하므로, 단위 테스트에서는 저장된 상태를 흉내 내 직접 넣는다 */
  private static CookingTicket ticket(long orderId, int cookTimeSec, Instant queuedAt) {
    CookingTicket ticket =
        CookingTicket.create(
            orderId,
            "261116-%04d".formatted(orderId),
            List.of(CookingTicketItem.of(1L, "아메리카노", null, 1, cookTimeSec)));
    ReflectionTestUtils.setField(ticket, "queuedAt", queuedAt);
    return ticket;
  }

  @Test
  void 전표가_없으면_COOKING_TICKET_NOT_FOUND() {
    when(repository.findByOrderId(99L)).thenReturn(Optional.empty());

    assertThatThrownBy(() -> service.getStatus(99L))
        .isInstanceOf(BusinessException.class)
        .extracting(e -> ((BusinessException) e).errorCode())
        .isEqualTo(ErrorCode.COOKING_TICKET_NOT_FOUND);
  }

  @Test
  void WAITING은_시작까지_조리중_남은시간과_앞_대기시간을_더하고_완료까지_내_조리시간을_더한다() {
    CookingTicket mine = ticket(3L, 200, NOW.minusSeconds(10));
    CookingTicket cooking = ticket(1L, 300, NOW.minusSeconds(120));
    cooking.start(NOW.minusSeconds(100)); // 100초 경과 → 남은 200초

    when(repository.findByOrderId(3L)).thenReturn(Optional.of(mine));
    when(repository.findByStatusOrderByQueuedAtAscIdAsc(TicketStatus.COOKING))
        .thenReturn(List.of(cooking));
    when(repository.countAheadByStatus(eq(TicketStatus.WAITING), eq(mine.getQueuedAt()), any()))
        .thenReturn(1L);
    when(repository.sumEstimatedCookSecAheadByStatus(
            eq(TicketStatus.WAITING), eq(mine.getQueuedAt()), any()))
        .thenReturn(150L);

    CookingStatusResponse res = service.getStatus(3L);

    assertThat(res.status()).isEqualTo(TicketStatus.WAITING);
    assertThat(res.waitingAhead()).isEqualTo(1);
    assertThat(res.estimatedCookSec()).isEqualTo(200);
    assertThat(res.expectedWaitSec()).isEqualTo(200 + 150); // 시작까지
    assertThat(res.expectedReadySec()).isEqualTo(200 + 150 + 200); // 완료까지
    assertThat(res.queuedAt().getOffset().getTotalSeconds()).isEqualTo(9 * 3600); // KST
  }

  @Test
  void COOKING은_시작까지_0이고_완료까지_남은_조리시간() {
    CookingTicket mine = ticket(1L, 300, NOW.minusSeconds(200));
    mine.start(NOW.minusSeconds(100)); // 100초 경과 → 남은 200초
    when(repository.findByOrderId(1L)).thenReturn(Optional.of(mine));

    CookingStatusResponse res = service.getStatus(1L);

    assertThat(res.status()).isEqualTo(TicketStatus.COOKING);
    assertThat(res.expectedWaitSec()).isZero();
    assertThat(res.expectedReadySec()).isEqualTo(200);
  }

  @Test
  void COOKING이_예상보다_오래_걸려도_완료까지는_음수가_되지_않는다() {
    CookingTicket mine = ticket(1L, 300, NOW.minusSeconds(500));
    mine.start(NOW.minusSeconds(400)); // 예상보다 오래 걸림
    when(repository.findByOrderId(1L)).thenReturn(Optional.of(mine));

    CookingStatusResponse res = service.getStatus(1L);

    assertThat(res.status()).isEqualTo(TicketStatus.COOKING);
    assertThat(res.expectedWaitSec()).isZero();
    assertThat(res.expectedReadySec()).isZero();
  }

  @Test
  void DONE은_예상시간_모두_0() {
    CookingTicket mine = ticket(1L, 300, NOW.minusSeconds(500));
    mine.start(NOW.minusSeconds(400));
    mine.complete(NOW.minusSeconds(50));
    when(repository.findByOrderId(1L)).thenReturn(Optional.of(mine));

    CookingStatusResponse res = service.getStatus(1L);

    assertThat(res.status()).isEqualTo(TicketStatus.DONE);
    assertThat(res.expectedWaitSec()).isZero();
    assertThat(res.expectedReadySec()).isZero();
    assertThat(res.completedAt()).isNotNull();
  }

  @Test
  void CANCELED는_예상시간_모두_0() {
    CookingTicket mine = ticket(1L, 300, NOW.minusSeconds(30));
    mine.cancel(NOW.minusSeconds(10));
    when(repository.findByOrderId(1L)).thenReturn(Optional.of(mine));

    CookingStatusResponse res = service.getStatus(1L);

    assertThat(res.status()).isEqualTo(TicketStatus.CANCELED);
    assertThat(res.expectedWaitSec()).isZero();
    assertThat(res.expectedReadySec()).isZero();
    assertThat(res.canceledAt()).isNotNull();
  }

  @Test
  void 대기열은_FIFO_순서대로_1번부터_번호를_매긴다() {
    CookingTicket first = ticket(10L, 100, NOW.minusSeconds(30));
    CookingTicket second = ticket(11L, 200, NOW.minusSeconds(20));
    when(repository.findByStatusOrderByQueuedAtAscIdAsc(TicketStatus.WAITING))
        .thenReturn(List.of(first, second));

    CookingQueueResponse res = service.getQueue();

    assertThat(res.count()).isEqualTo(2);
    assertThat(res.items())
        .extracting(CookingQueueResponse.Entry::position, CookingQueueResponse.Entry::orderId)
        .containsExactly(tuple(1, 10L), tuple(2, 11L));
  }

  @Test
  void 대기열이_비어_있으면_빈_목록() {
    when(repository.findByStatusOrderByQueuedAtAscIdAsc(TicketStatus.WAITING))
        .thenReturn(List.of());

    CookingQueueResponse res = service.getQueue();

    assertThat(res.count()).isZero();
    assertThat(res.items()).isEmpty();
  }
}
