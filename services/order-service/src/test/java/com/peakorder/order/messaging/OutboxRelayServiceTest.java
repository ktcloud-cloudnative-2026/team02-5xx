package com.peakorder.order.messaging;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.peakorder.order.repository.OutboxEventRepository;
import com.peakorder.order.repository.OutboxEventRepository.PendingEvent;
import java.time.Clock;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class OutboxRelayServiceTest {

  private final OffsetDateTime now = OffsetDateTime.parse("2026-11-16T10:00:00+09:00");

  private OutboxEventRepository repository;
  private EventPublisher publisher;
  private OutboxRelayService service;

  private PendingEvent event(long id) {
    return new PendingEvent(id, UUID.randomUUID(), "OrderConfirmed", "{}");
  }

  @BeforeEach
  void setUp() {
    repository = mock(OutboxEventRepository.class);
    publisher = mock(EventPublisher.class);
    service =
        new OutboxRelayService(
            repository, publisher, Clock.fixed(now.toInstant(), ZoneId.of("Asia/Seoul")), 50);
  }

  @Test
  void publishes_pending_events_in_order_and_marks_them_sent() {
    PendingEvent e1 = event(1);
    PendingEvent e2 = event(2);
    when(repository.findPendingForUpdate(50)).thenReturn(List.of(e1, e2));

    int sent = service.relayPending();

    assertThat(sent).isEqualTo(2);
    org.mockito.InOrder order = org.mockito.Mockito.inOrder(publisher, repository);
    order.verify(publisher).publish(e1);
    order.verify(repository).markSent(1L, now);
    order.verify(publisher).publish(e2);
    order.verify(repository).markSent(2L, now);
  }

  @Test
  void failed_publish_keeps_that_event_and_the_rest_pending_without_throwing() {
    PendingEvent e1 = event(1);
    PendingEvent e2 = event(2);
    PendingEvent e3 = event(3);
    when(repository.findPendingForUpdate(50)).thenReturn(List.of(e1, e2, e3));
    doThrow(new IllegalStateException("broker down")).when(publisher).publish(e2);

    int sent = service.relayPending();

    assertThat(sent).isEqualTo(1);
    verify(repository).markSent(1L, now);
    verify(repository, never()).markSent(2L, now);
    verify(publisher, never()).publish(e3);
    verify(repository, never()).markSent(3L, now);
  }

  @Test
  void nothing_to_do_when_no_pending_events() {
    when(repository.findPendingForUpdate(50)).thenReturn(List.of());

    assertThat(service.relayPending()).isZero();
    verify(publisher, never()).publish(any());
  }
}
