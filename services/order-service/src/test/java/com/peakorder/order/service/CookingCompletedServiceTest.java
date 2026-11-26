package com.peakorder.order.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.peakorder.order.entity.Order;
import com.peakorder.order.entity.OrderStatus;
import com.peakorder.order.messaging.CookingCompletedEvent;
import com.peakorder.order.messaging.ListenerRetryPolicy;
import com.peakorder.order.repository.OrderRepository;
import com.peakorder.order.repository.ProcessedEventRepository;
import java.time.Clock;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;

class CookingCompletedServiceTest {

  private final OffsetDateTime now = OffsetDateTime.parse("2026-11-16T10:00:00+09:00");
  private final OffsetDateTime completedAt = OffsetDateTime.parse("2026-11-16T09:58:00+09:00");

  private ProcessedEventRepository processed;
  private OrderRepository orders;
  private CookingCompletedService service;
  private final UUID eventId = UUID.randomUUID();

  @BeforeEach
  void setUp() {
    processed = mock(ProcessedEventRepository.class);
    orders = mock(OrderRepository.class);
    service =
        new CookingCompletedService(
            processed, orders, Clock.fixed(now.toInstant(), ZoneId.of("Asia/Seoul")));
    when(processed.insertIfAbsent(eventId, now)).thenReturn(true);
  }

  private Order orderIn(OrderStatus status) {
    Order order = Order.createTemporary(7L, now.minusMinutes(10));
    order.addItem(1L, "아메리카노", 3000, 1, List.of());
    if (status == OrderStatus.PAID) {
      order.markConfirmed("261116-0001", 9L, now.minusMinutes(9));
    } else if (status != OrderStatus.CREATED) {
      order.changeStatus(status, null, now.minusMinutes(9));
    }
    return order;
  }

  @Test
  void completes_confirmed_order_and_records_history_and_completed_time() {
    Order order = orderIn(OrderStatus.PAID);
    when(orders.findWithLockById(5L)).thenReturn(Optional.of(order));

    service.handle(new CookingCompletedEvent(eventId, 5L, completedAt));

    assertThat(order.getStatus()).isEqualTo(OrderStatus.COMPLETED);
    assertThat(order.getCompletedAt()).isEqualTo(completedAt);
    assertThat(order.getHistories()).hasSize(3);
    assertThat(order.getHistories().get(2).getToStatus()).isEqualTo(OrderStatus.COMPLETED);
  }

  @Test
  void completion_is_logged_with_order_id_and_order_no() {
    Order order = orderIn(OrderStatus.PAID);
    when(orders.findWithLockById(5L)).thenReturn(Optional.of(order));
    Logger logger = (Logger) LoggerFactory.getLogger(CookingCompletedService.class);
    ListAppender<ILoggingEvent> logs = new ListAppender<>();
    logs.start();
    logger.addAppender(logs);
    try {
      service.handle(new CookingCompletedEvent(eventId, 5L, completedAt));
    } finally {
      logger.detachAppender(logs);
    }

    assertThat(logs.list)
        .extracting(ILoggingEvent::getFormattedMessage)
        .contains("조리 완료 반영 orderId=5 orderNo=261116-0001");
  }

  @Test
  void duplicate_event_is_ignored_without_touching_the_order() {
    when(processed.insertIfAbsent(eventId, now)).thenReturn(false);

    service.handle(new CookingCompletedEvent(eventId, 5L, completedAt));

    verify(orders, never()).findWithLockById(5L);
  }

  @Test
  void unknown_order_fails_with_a_non_retryable_error_so_it_goes_straight_to_dlq() {
    when(orders.findWithLockById(5L)).thenReturn(Optional.empty());

    assertThatThrownBy(() -> service.handle(new CookingCompletedEvent(eventId, 5L, completedAt)))
        .isInstanceOf(IllegalArgumentException.class)
        .satisfies(e -> assertThat(ListenerRetryPolicy.isRetryable(e)).isFalse());
  }

  @Test
  void completion_for_canceled_or_unconfirmed_order_is_not_applied() {
    for (OrderStatus status :
        List.of(OrderStatus.CANCELED, OrderStatus.FAILED, OrderStatus.CREATED)) {
      Order order = orderIn(status);
      when(orders.findWithLockById(5L)).thenReturn(Optional.of(order));

      assertThatThrownBy(() -> service.handle(new CookingCompletedEvent(eventId, 5L, completedAt)))
          .isInstanceOf(IllegalStateException.class);
      assertThat(order.getStatus()).isEqualTo(status);
    }
  }

  @Test
  void already_completed_order_is_left_as_is() {
    Order order = orderIn(OrderStatus.PAID);
    order.markCompleted(completedAt, now);
    int histories = order.getHistories().size();
    when(orders.findWithLockById(5L)).thenReturn(Optional.of(order));

    service.handle(new CookingCompletedEvent(eventId, 5L, now));

    assertThat(order.getHistories()).hasSize(histories);
    assertThat(order.getCompletedAt()).isEqualTo(completedAt);
  }
}
