package com.peakorder.order.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.peakorder.order.client.MenuClient.ValidatedMenu;
import com.peakorder.order.client.MenuClient.ValidatedOption;
import com.peakorder.order.dto.OrderDetailResponse;
import com.peakorder.order.entity.Order;
import com.peakorder.order.entity.OrderItemOption;
import com.peakorder.order.entity.OrderStatus;
import com.peakorder.order.repository.OrderNoRepository;
import com.peakorder.order.repository.OrderRepository;
import com.peakorder.order.repository.OutboxEventRepository;
import java.time.Clock;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

class OrderTxServiceTest {

  private final OffsetDateTime now = OffsetDateTime.parse("2026-11-13T10:00:00+09:00");

  private OrderRepository orderRepository;
  private OrderNoRepository orderNoRepository;
  private OutboxEventRepository outboxRepository;
  private final JsonMapper jsonMapper = JsonMapper.builder().build();
  private OrderTxService service;

  @BeforeEach
  void setUp() {
    orderRepository = mock(OrderRepository.class);
    orderNoRepository = mock(OrderNoRepository.class);
    outboxRepository = mock(OutboxEventRepository.class);
    service =
        new OrderTxService(
            orderRepository,
            orderNoRepository,
            outboxRepository,
            jsonMapper,
            Clock.fixed(now.toInstant(), ZoneId.of("Asia/Seoul")));
  }

  private List<ValidatedMenu> menus() {
    return List.of(
        new ValidatedMenu(
            1L, "아메리카노", 3000, 120, List.of(new ValidatedOption(10L, "샷 추가", 500, 30))));
  }

  private Order orderWithItems() {
    Order order = Order.createTemporary(7L, now);
    order.addItem(1L, "아메리카노", 3000, 2, List.of(new OrderItemOption(10L, "샷 추가", 500)));
    return order;
  }

  @Test
  void payment_requested_marker_is_saved_only_while_the_order_is_created() {
    Order created = orderWithItems();
    when(orderRepository.findWithLockById(100L)).thenReturn(Optional.of(created));
    assertThat(service.markPaymentRequested(100L)).isTrue();
    assertThat(created.getPaymentRequestedAt()).isEqualTo(now);

    Order failed = orderWithItems();
    failed.markFailed("HOLD_EXPIRED", now);
    when(orderRepository.findWithLockById(101L)).thenReturn(Optional.of(failed));
    assertThat(service.markPaymentRequested(101L)).isFalse();
    assertThat(failed.getPaymentRequestedAt()).isNull();

    Order paid = orderWithItems();
    paid.markConfirmed("261113-0001", 9L, now);
    when(orderRepository.findWithLockById(102L)).thenReturn(Optional.of(paid));
    assertThat(service.markPaymentRequested(102L)).isFalse();
    assertThat(paid.getPaymentRequestedAt()).isNull();

    when(orderRepository.findWithLockById(103L)).thenReturn(Optional.empty());
    assertThat(service.markPaymentRequested(103L)).isFalse();
  }

  @Test
  void pay_lock_is_acquired_only_when_exactly_one_row_was_updated() {
    when(orderRepository.acquirePayLock(100L, now, now.plus(OrderTxService.PAY_LOCK_TTL)))
        .thenReturn(1);
    when(orderRepository.acquirePayLock(101L, now, now.plus(OrderTxService.PAY_LOCK_TTL)))
        .thenReturn(0);

    assertThat(service.tryAcquirePayLock(100L)).isTrue();
    assertThat(service.tryAcquirePayLock(101L)).isFalse();
  }

  @Test
  void confirm_issues_order_no_and_saves_outbox_event_in_same_call() throws Exception {
    Order order = orderWithItems();
    when(orderRepository.findWithLockById(100L)).thenReturn(Optional.of(order));
    when(orderNoRepository.nextSequence(LocalDate.of(2026, 11, 13))).thenReturn(7);

    OrderDetailResponse response = service.confirmOrder(100L, 9L, menus());

    assertThat(response.status()).isEqualTo(OrderStatus.PAID);
    assertThat(response.orderNo()).isEqualTo("261113-0007");
    assertThat(order.getPaymentId()).isEqualTo(9L);

    ArgumentCaptor<UUID> eventId = ArgumentCaptor.forClass(UUID.class);
    ArgumentCaptor<String> payload = ArgumentCaptor.forClass(String.class);
    verify(outboxRepository)
        .insertPending(eventId.capture(), eq("OrderConfirmed"), payload.capture(), eq(now));
    JsonNode json = jsonMapper.readTree(payload.getValue());
    assertThat(json.get("eventId").asString()).isEqualTo(eventId.getValue().toString());
    assertThat(json.get("orderNo").asString()).isEqualTo("261113-0007");
    assertThat(json.get("userId").asLong()).isEqualTo(7L);
    assertThat(json.get("items").get(0).get("menuName").asString()).isEqualTo("아메리카노");
    assertThat(json.get("items").get(0).get("quantity").asInt()).isEqualTo(2);
    assertThat(json.get("items").get(0).get("cookTimeSec").asInt()).isEqualTo(120);
    assertThat(json.get("items").get(0).get("options").get(0).get("optionName").asString())
        .isEqualTo("샷 추가");
    assertThat(json.get("items").get(0).get("options").get(0).get("extraCookTimeSec").asInt())
        .isEqualTo(30);
  }

  @Test
  void confirm_on_already_confirmed_order_changes_nothing() {
    Order order = orderWithItems();
    order.markConfirmed("261113-0001", 9L, now);
    when(orderRepository.findWithLockById(100L)).thenReturn(Optional.of(order));

    OrderDetailResponse response = service.confirmOrder(100L, 9L, menus());

    assertThat(response.orderNo()).isEqualTo("261113-0001");
    verify(orderNoRepository, never()).nextSequence(any());
    verify(outboxRepository, never()).insertPending(any(), any(), any(), any());
  }

  @Test
  void mark_failed_only_affects_orders_still_in_created() {
    Order created = orderWithItems();
    Order paid = orderWithItems();
    paid.markConfirmed("261113-0001", 9L, now);
    when(orderRepository.findWithLockById(1L)).thenReturn(Optional.of(created));
    when(orderRepository.findWithLockById(2L)).thenReturn(Optional.of(paid));

    service.markFailed(1L, "PAYMENT_FAILED");
    service.markFailed(2L, "PAYMENT_FAILED");

    assertThat(created.getStatus()).isEqualTo(OrderStatus.FAILED);
    assertThat(paid.getStatus()).isEqualTo(OrderStatus.PAID);
  }
}
