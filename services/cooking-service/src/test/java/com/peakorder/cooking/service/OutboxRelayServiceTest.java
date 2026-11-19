package com.peakorder.cooking.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.peakorder.cooking.config.ClockConfig;
import com.peakorder.cooking.entity.OutboxEvent;
import com.peakorder.cooking.entity.OutboxStatus;
import com.peakorder.cooking.messaging.EventPublisher;
import com.peakorder.cooking.repository.OutboxEventRepository;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class OutboxRelayServiceTest {

  private static final Instant NOW = Instant.parse("2026-11-17T01:00:00Z");

  private OutboxEventRepository repository;
  private EventPublisher publisher;
  private OutboxRelayService service;

  @BeforeEach
  void setUp() {
    repository = mock(OutboxEventRepository.class);
    publisher = mock(EventPublisher.class);
    service = new OutboxRelayService(repository, publisher, Clock.fixed(NOW, ClockConfig.ZONE), 50);
  }

  private static OutboxEvent pending(long orderId) {
    return OutboxEvent.create(
        "CookingCompleted", "{\"orderId\":" + orderId + "}", NOW.minusSeconds(10));
  }

  @Test
  void 발행에_성공한_이벤트는_SENT로_바꾼다() {
    OutboxEvent e1 = pending(1);
    OutboxEvent e2 = pending(2);
    when(repository.findPendingForUpdate(50)).thenReturn(List.of(e1, e2));

    int sent = service.relayPending();

    assertThat(sent).isEqualTo(2);
    assertThat(e1.getStatus()).isEqualTo(OutboxStatus.SENT);
    assertThat(e1.getSentAt()).isEqualTo(NOW);
    assertThat(e2.getStatus()).isEqualTo(OutboxStatus.SENT);
  }

  @Test
  void 발행에_실패하면_그_이벤트부터는_PENDING으로_남기고_멈춘다() {
    OutboxEvent e1 = pending(1);
    OutboxEvent e2 = pending(2);
    OutboxEvent e3 = pending(3);
    when(repository.findPendingForUpdate(50)).thenReturn(List.of(e1, e2, e3));
    doThrow(new IllegalStateException("라우팅할 큐가 없음")).when(publisher).publish(e2);

    int sent = service.relayPending();

    assertThat(sent).isEqualTo(1);
    assertThat(e1.getStatus()).isEqualTo(OutboxStatus.SENT);
    assertThat(e2.getStatus()).isEqualTo(OutboxStatus.PENDING);
    assertThat(e3.getStatus()).isEqualTo(OutboxStatus.PENDING);
    verify(publisher, never()).publish(e3); // 순서 유지를 위해 뒤의 이벤트는 이번 주기에 보내지 않음
  }

  @Test
  void 대기_이벤트가_없으면_발행하지_않는다() {
    when(repository.findPendingForUpdate(50)).thenReturn(List.of());

    assertThat(service.relayPending()).isZero();
    verify(publisher, never()).publish(any());
  }
}
