package com.peakorder.cooking.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.tuple;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.peakorder.cooking.entity.CookingTicket;
import com.peakorder.cooking.entity.CookingTicketItem;
import com.peakorder.cooking.entity.TicketStatus;
import com.peakorder.cooking.messaging.OrderConfirmedEvent;
import com.peakorder.cooking.messaging.OrderConfirmedEvent.Item;
import com.peakorder.cooking.messaging.OrderConfirmedEvent.Option;
import com.peakorder.cooking.repository.CookingTicketRepository;
import com.peakorder.cooking.repository.ProcessedEventRepository;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

class OrderConfirmedServiceTest {

  private ProcessedEventRepository processedEventRepository;
  private CookingTicketRepository ticketRepository;
  private OrderConfirmedService service;

  @BeforeEach
  void setUp() {
    processedEventRepository = mock(ProcessedEventRepository.class);
    ticketRepository = mock(CookingTicketRepository.class);
    service = new OrderConfirmedService(processedEventRepository, ticketRepository);
  }

  /** 합의 문서 예시: 아메리카노 2개(120초 + 옵션 30초), 라떼 1개(90초) */
  private static OrderConfirmedEvent sampleEvent() {
    return new OrderConfirmedEvent(
        UUID.randomUUID(),
        1L,
        "261116-0001",
        7L,
        OffsetDateTime.parse("2026-11-16T10:16:19+09:00"),
        List.of(
            new Item(1L, "아메리카노", 2, 120, List.of(new Option(10L, "샷 추가", 30))),
            new Item(2L, "라떼", 1, 90, List.of())));
  }

  @Test
  void 처음_받은_이벤트는_합의된_매핑으로_WAITING_전표를_만든다() {
    OrderConfirmedEvent event = sampleEvent();
    when(processedEventRepository.insertIfAbsent(event.eventId())).thenReturn(1);
    when(ticketRepository.findByOrderId(1L)).thenReturn(Optional.empty());

    service.handle(event);

    ArgumentCaptor<CookingTicket> captor = ArgumentCaptor.forClass(CookingTicket.class);
    verify(ticketRepository).save(captor.capture());
    CookingTicket ticket = captor.getValue();
    assertThat(ticket.getStatus()).isEqualTo(TicketStatus.WAITING);
    assertThat(ticket.getOrderId()).isEqualTo(1L);
    assertThat(ticket.getOrderNo()).isEqualTo("261116-0001");
    assertThat(ticket.getQueuedAt()).isNull(); // 앱이 정하지 않음 — 저장 시 DB가 기록(confirmedAt도 쓰지 않음)
    assertThat(ticket.getEstimatedCookSec()).isEqualTo((150 * 2) + (90 * 1)); // 390
    assertThat(ticket.getItems())
        .extracting(
            CookingTicketItem::getMenuName,
            CookingTicketItem::getCookTimeSec,
            CookingTicketItem::getOptionSummary)
        .containsExactly(tuple("아메리카노", 150, "샷 추가"), tuple("라떼", 90, null));
  }

  @Test
  void 여러_옵션은_조리시간을_모두_더하고_이름을_쉼표로_잇는다() {
    CookingTicketItem item =
        OrderConfirmedService.toItem(
            new Item(
                1L, "버거", 1, 300, List.of(new Option(1L, "세트", 60), new Option(2L, "치즈 추가", 20))));

    assertThat(item.getCookTimeSec()).isEqualTo(380);
    assertThat(item.getOptionSummary()).isEqualTo("세트, 치즈 추가");
  }

  @Test
  void 옵션이_null이어도_기본_조리시간으로_처리한다() {
    CookingTicketItem item = OrderConfirmedService.toItem(new Item(1L, "라떼", 1, 90, null));

    assertThat(item.getCookTimeSec()).isEqualTo(90);
    assertThat(item.getOptionSummary()).isNull();
  }

  @Test
  void 이미_처리한_eventId면_전표를_만들지_않는다() {
    OrderConfirmedEvent event = sampleEvent();
    when(processedEventRepository.insertIfAbsent(event.eventId())).thenReturn(0);

    service.handle(event);

    verify(ticketRepository, never()).findByOrderId(any());
    verify(ticketRepository, never()).save(any());
  }

  @Test
  void 같은_주문의_전표가_이미_있으면_새로_만들지_않는다() {
    OrderConfirmedEvent event = sampleEvent();
    when(processedEventRepository.insertIfAbsent(event.eventId())).thenReturn(1);
    when(ticketRepository.findByOrderId(1L)).thenReturn(Optional.of(mock(CookingTicket.class)));

    service.handle(event);

    verify(ticketRepository, never()).save(any());
  }

  @Test
  void 수량이_0이하면_재시도하지_않는_오류로_실패한다() {
    OrderConfirmedEvent event =
        new OrderConfirmedEvent(
            UUID.randomUUID(),
            1L,
            "261116-0001",
            7L,
            null,
            List.of(new Item(1L, "라떼", 0, 90, null)));
    when(processedEventRepository.insertIfAbsent(event.eventId())).thenReturn(1);
    when(ticketRepository.findByOrderId(1L)).thenReturn(Optional.empty());

    assertThatThrownBy(() -> service.handle(event)).isInstanceOf(IllegalArgumentException.class);
  }
}
