package com.peakorder.cooking.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.peakorder.cooking.config.ClockConfig;
import com.peakorder.cooking.entity.CookingTicket;
import com.peakorder.cooking.entity.CookingTicketItem;
import com.peakorder.cooking.entity.OutboxEvent;
import com.peakorder.cooking.entity.OutboxStatus;
import com.peakorder.cooking.entity.TicketStatus;
import com.peakorder.cooking.messaging.CookingCompletedEvent;
import com.peakorder.cooking.repository.CookingTicketRepository;
import com.peakorder.cooking.repository.OutboxEventRepository;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;
import tools.jackson.databind.json.JsonMapper;

class CookingProgressServiceTest {

  private static final Instant NOW = Instant.parse("2026-11-17T01:00:00Z");

  private CookingTicketRepository ticketRepository;
  private OutboxEventRepository outboxEventRepository;
  private final JsonMapper jsonMapper = JsonMapper.builder().build();
  private CookingProgressService service;

  @BeforeEach
  void setUp() {
    ticketRepository = mock(CookingTicketRepository.class);
    outboxEventRepository = mock(OutboxEventRepository.class);
    service =
        new CookingProgressService(
            ticketRepository,
            outboxEventRepository,
            jsonMapper,
            Clock.fixed(NOW, ClockConfig.ZONE));
    when(ticketRepository.tryAdvisoryXactLock(anyLong())).thenReturn(true);
    when(ticketRepository.findFirstWithLockByStatusOrderByQueuedAtAscIdAsc(any()))
        .thenReturn(Optional.empty());
  }

  /** 예상 조리 시간 = cookTimeSec (수량 1) */
  private static CookingTicket ticket(long orderId, int cookTimeSec) {
    return CookingTicket.create(
        orderId,
        "261117-%04d".formatted(orderId),
        List.of(CookingTicketItem.of(1L, "아메리카노", null, 1, cookTimeSec)));
  }

  private void givenFirst(TicketStatus status, CookingTicket ticket) {
    when(ticketRepository.findFirstWithLockByStatusOrderByQueuedAtAscIdAsc(status))
        .thenReturn(Optional.of(ticket));
  }

  @Test
  void 다른_인스턴스가_실행_중이면_아무것도_하지_않는다() {
    when(ticketRepository.tryAdvisoryXactLock(anyLong())).thenReturn(false);

    service.tick();

    verify(ticketRepository, never()).findFirstWithLockByStatusOrderByQueuedAtAscIdAsc(any());
    verify(outboxEventRepository, never()).save(any());
  }

  @Test
  void 조리_중이_없으면_FIFO_첫_대기_주문을_시작한다() {
    CookingTicket waiting = ticket(2L, 120);
    givenFirst(TicketStatus.WAITING, waiting);

    service.tick();

    assertThat(waiting.getStatus()).isEqualTo(TicketStatus.COOKING);
    assertThat(waiting.getStartedAt()).isEqualTo(NOW);
  }

  @Test
  void 예상_조리_시간이_지나지_않았으면_완료도_다음_시작도_하지_않는다() {
    CookingTicket cooking = ticket(1L, 300);
    cooking.start(NOW.minusSeconds(100)); // 200초 남음
    CookingTicket waiting = ticket(2L, 120);
    givenFirst(TicketStatus.COOKING, cooking);
    givenFirst(TicketStatus.WAITING, waiting);

    service.tick();

    assertThat(cooking.getStatus()).isEqualTo(TicketStatus.COOKING);
    assertThat(waiting.getStatus()).isEqualTo(TicketStatus.WAITING);
    verify(outboxEventRepository, never()).save(any());
  }

  @Test
  void 예상_조리_시간이_지나면_완료하고_outbox에_저장한_뒤_다음_주문을_시작한다() {
    CookingTicket cooking = ticket(1L, 300);
    cooking.start(NOW.minusSeconds(300)); // 딱 300초 경과
    CookingTicket waiting = ticket(2L, 120);
    givenFirst(TicketStatus.COOKING, cooking);
    givenFirst(TicketStatus.WAITING, waiting);

    service.tick();

    assertThat(cooking.getStatus()).isEqualTo(TicketStatus.DONE);
    assertThat(cooking.getCompletedAt()).isEqualTo(NOW);
    assertThat(waiting.getStatus()).isEqualTo(TicketStatus.COOKING);

    ArgumentCaptor<OutboxEvent> captor = ArgumentCaptor.forClass(OutboxEvent.class);
    verify(outboxEventRepository).save(captor.capture());
    OutboxEvent outbox = captor.getValue();
    assertThat(outbox.getEventType()).isEqualTo("CookingCompleted");
    assertThat(outbox.getStatus()).isEqualTo(OutboxStatus.PENDING);
    CookingCompletedEvent payload =
        jsonMapper.readValue(outbox.getPayload(), CookingCompletedEvent.class);
    assertThat(payload.eventId()).isEqualTo(outbox.getEventId()); // messageId와 본문 eventId 일치
    assertThat(payload.orderId()).isEqualTo(1L);
    assertThat(payload.completedAt().toInstant()).isEqualTo(NOW);
    // 계약: completedAt은 +09:00으로 보낸다 (읽을 때 Jackson이 UTC로 바꾸므로 JSON 문자열로 확인)
    assertThat(outbox.getPayload()).contains("\"completedAt\":\"2026-11-17T10:00:00+09:00\"");

    // 완료를 DB에 먼저 반영(flush)한 뒤 다음 전표를 시작해야 V2 제약(COOKING 1건)에 걸리지 않는다
    InOrder order = inOrder(ticketRepository);
    order.verify(ticketRepository).flush();
    order
        .verify(ticketRepository)
        .findFirstWithLockByStatusOrderByQueuedAtAscIdAsc(TicketStatus.WAITING);
  }

  @Test
  void 대기_주문이_없으면_시작하지_않는다() {
    service.tick();

    verify(outboxEventRepository, never()).save(any());
  }
}
