package com.peakorder.order.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
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
import com.peakorder.order.exception.BusinessException;
import com.peakorder.order.exception.ErrorCode;
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

  private static final UUID TOKEN = UUID.fromString("00000000-0000-0000-0000-000000000042");
  private static final UUID OTHER = UUID.fromString("00000000-0000-0000-0000-000000000043");

  private Order lockedBy(UUID token) {
    Order order = orderWithItems();
    org.springframework.test.util.ReflectionTestUtils.setField(order, "payLockToken", token);
    return order;
  }

  @Test
  void payment_requested_marker_is_saved_only_while_the_order_is_created_and_the_lock_is_mine() {
    Order created = lockedBy(TOKEN);
    when(orderRepository.findWithLockById(100L)).thenReturn(Optional.of(created));
    assertThat(service.markPaymentRequested(100L, TOKEN)).isTrue();
    assertThat(created.getPaymentRequestedAt()).isEqualTo(now);

    Order failed = lockedBy(TOKEN);
    failed.markFailed("HOLD_EXPIRED", now);
    when(orderRepository.findWithLockById(101L)).thenReturn(Optional.of(failed));
    assertThat(service.markPaymentRequested(101L, TOKEN)).isFalse();
    assertThat(failed.getPaymentRequestedAt()).isNull();

    Order paid = lockedBy(TOKEN);
    paid.markConfirmed("261113-0001", 9L, now);
    when(orderRepository.findWithLockById(102L)).thenReturn(Optional.of(paid));
    assertThat(service.markPaymentRequested(102L, TOKEN)).isFalse();
    assertThat(paid.getPaymentRequestedAt()).isNull();

    when(orderRepository.findWithLockById(103L)).thenReturn(Optional.empty());
    assertThat(service.markPaymentRequested(103L, TOKEN)).isFalse();
  }

  @Test
  void a_request_that_lost_the_lock_cannot_mark_record_fail_or_confirm_the_order() {
    // 독점이 만료돼 다른 요청(OTHER)이 이어받은 뒤 이전 요청(TOKEN)이 늦게 도착한 경우
    Order order = lockedBy(OTHER);
    when(orderRepository.findWithLockById(100L)).thenReturn(Optional.of(order));

    assertThat(service.markPaymentRequested(100L, TOKEN)).isFalse();
    service.recordPaymentId(100L, TOKEN, 9L);
    assertThat(service.markFailed(100L, TOKEN, "PAYMENT_FAILED")).isFalse();
    assertThatThrownBy(() -> service.confirmOrder(100L, TOKEN, 9L, menus()))
        .isInstanceOfSatisfying(
            BusinessException.class,
            e -> assertThat(e.errorCode()).isEqualTo(ErrorCode.ORDER_PAY_IN_PROGRESS));

    assertThat(order.getStatus()).isEqualTo(OrderStatus.CREATED);
    assertThat(order.getPaymentRequestedAt()).isNull();
    assertThat(order.getPaymentId()).isNull();
    verify(outboxRepository, never()).insertPending(any(), any(), any(), any());
  }

  @Test
  void the_lock_owner_can_fail_the_order_and_record_the_payment_id() {
    Order order = lockedBy(TOKEN);
    when(orderRepository.findWithLockById(100L)).thenReturn(Optional.of(order));

    service.recordPaymentId(100L, TOKEN, 9L);
    assertThat(order.getPaymentId()).isEqualTo(9L);
    assertThat(service.markFailed(100L, TOKEN, "STOCK_CONFIRM_FAILED")).isTrue();
    assertThat(order.getStatus()).isEqualTo(OrderStatus.FAILED);
  }

  @Test
  void pay_lock_is_acquired_only_when_exactly_one_row_was_updated_and_the_token_is_returned() {
    when(orderRepository.acquirePayLock(
            eq(100L), eq(now), eq(now.plus(OrderTxService.PAY_LOCK_TTL)), any(), any()))
        .thenReturn(1);
    when(orderRepository.acquirePayLock(
            eq(101L), eq(now), eq(now.plus(OrderTxService.PAY_LOCK_TTL)), any(), any()))
        .thenReturn(0);

    assertThat(service.tryAcquirePayLock(100L)).isPresent();
    assertThat(service.tryAcquirePayLock(101L)).isEmpty();
  }

  @Test
  void every_acquisition_uses_a_new_token_so_the_previous_owner_is_told_apart() {
    when(orderRepository.acquirePayLock(any(), any(), any(), any(), any())).thenReturn(1);

    assertThat(service.tryAcquirePayLock(100L).orElseThrow())
        .isNotEqualTo(service.tryAcquirePayLock(100L).orElseThrow());
  }

  @Test
  void renew_and_release_are_scoped_to_the_token() {
    when(orderRepository.renewPayLock(100L, now.plus(OrderTxService.PAY_LOCK_TTL), TOKEN))
        .thenReturn(1);
    when(orderRepository.renewPayLock(100L, now.plus(OrderTxService.PAY_LOCK_TTL), OTHER))
        .thenReturn(0);

    assertThat(service.renewPayLock(100L, TOKEN)).isTrue();
    assertThat(service.renewPayLock(100L, OTHER)).isFalse();

    service.releasePayLock(100L, TOKEN);
    verify(orderRepository).releasePayLock(100L, TOKEN);
  }

  // ---- 주문 취소(OR-05) ----

  @Test
  void cancel_lock_is_allowed_for_confirmed_and_canceled_orders_but_pay_lock_only_for_created() {
    when(orderRepository.acquirePayLock(any(), any(), any(), any(), any())).thenReturn(1);

    service.tryAcquirePayLock(100L);
    service.tryAcquireCancelLock(100L);

    @SuppressWarnings("unchecked")
    ArgumentCaptor<java.util.Collection<OrderStatus>> statuses =
        ArgumentCaptor.forClass(java.util.Collection.class);
    verify(orderRepository, org.mockito.Mockito.times(2))
        .acquirePayLock(any(), any(), any(), any(), statuses.capture());
    assertThat(statuses.getAllValues().get(0)).containsExactly(OrderStatus.CREATED);
    assertThat(statuses.getAllValues().get(1))
        .containsExactlyInAnyOrder(
            OrderStatus.CREATED,
            OrderStatus.PAID,
            OrderStatus.WAITING,
            OrderStatus.COOKING,
            OrderStatus.CANCELED);
  }

  @Test
  void only_the_lock_owner_can_cancel_and_record_follow_up_steps() {
    Order paid = lockedBy(OTHER);
    paid.markConfirmed("261113-0001", 9L, now);
    when(orderRepository.findWithLockById(100L)).thenReturn(Optional.of(paid));

    assertThat(service.markCanceled(100L, TOKEN, "CUSTOMER_CANCEL")).isFalse();
    assertThat(paid.getStatus()).isEqualTo(OrderStatus.PAID);

    Order mine = lockedBy(TOKEN);
    mine.markConfirmed("261113-0002", 10L, now);
    when(orderRepository.findWithLockById(101L)).thenReturn(Optional.of(mine));
    assertThat(service.markCanceled(101L, TOKEN, "CUSTOMER_CANCEL")).isTrue();
    assertThat(mine.getStatus()).isEqualTo(OrderStatus.CANCELED);
    assertThat(mine.getCancelReason()).isEqualTo("CUSTOMER_CANCEL");
    assertThat(mine.getCanceledAt()).isEqualTo(now);

    assertThat(service.markStockRestored(101L, OTHER)).isFalse();
    assertThat(service.markRefunded(101L, OTHER)).isFalse();
    assertThat(mine.getStockRestoredAt()).isNull();
    assertThat(service.markStockRestored(101L, TOKEN)).isTrue();
    assertThat(service.markRefunded(101L, TOKEN)).isTrue();
    assertThat(mine.getStockRestoredAt()).isEqualTo(now);
    assertThat(mine.getRefundedAt()).isEqualTo(now);
  }

  @Test
  void completed_and_failed_orders_cannot_be_canceled_and_a_second_cancel_is_a_no_op() {
    Order completed = lockedBy(TOKEN);
    completed.markConfirmed("261113-0003", 9L, now);
    completed.markCompleted(now, now);
    when(orderRepository.findWithLockById(100L)).thenReturn(Optional.of(completed));
    assertThat(service.markCanceled(100L, TOKEN, "CUSTOMER_CANCEL")).isFalse();
    assertThat(completed.getStatus()).isEqualTo(OrderStatus.COMPLETED);

    Order failed = lockedBy(TOKEN);
    failed.markFailed("PAYMENT_FAILED", now);
    when(orderRepository.findWithLockById(101L)).thenReturn(Optional.of(failed));
    assertThat(service.markCanceled(101L, TOKEN, "CUSTOMER_CANCEL")).isFalse();

    Order canceled = lockedBy(TOKEN);
    canceled.markCanceled("CUSTOMER_CANCEL", now);
    when(orderRepository.findWithLockById(102L)).thenReturn(Optional.of(canceled));
    assertThat(service.markCanceled(102L, TOKEN, "OTHER_REASON")).isTrue();
    assertThat(canceled.getCancelReason()).isEqualTo("CUSTOMER_CANCEL");
    assertThat(canceled.getHistories()).hasSize(2);
  }

  @Test
  void cancel_request_is_recorded_only_for_the_lock_owner_of_a_cancelable_confirmed_order() {
    Order paid = lockedBy(TOKEN);
    paid.markConfirmed("261113-0001", 9L, now);
    when(orderRepository.findWithLockById(100L)).thenReturn(Optional.of(paid));
    assertThat(service.markCancelRequested(100L, OTHER)).isFalse();
    assertThat(paid.getCancelRequestedAt()).isNull();
    assertThat(service.markCancelRequested(100L, TOKEN)).isTrue();
    assertThat(paid.getCancelRequestedAt()).isEqualTo(now);

    service.clearCancelRequested(100L, OTHER);
    assertThat(paid.getCancelRequestedAt()).isEqualTo(now);
    service.clearCancelRequested(100L, TOKEN);
    assertThat(paid.getCancelRequestedAt()).isNull();

    Order created = lockedBy(TOKEN);
    when(orderRepository.findWithLockById(101L)).thenReturn(Optional.of(created));
    assertThat(service.markCancelRequested(101L, TOKEN)).isFalse();

    Order completed = lockedBy(TOKEN);
    completed.markConfirmed("261113-0002", 9L, now);
    completed.markCompleted(now, now);
    when(orderRepository.findWithLockById(102L)).thenReturn(Optional.of(completed));
    assertThat(service.markCancelRequested(102L, TOKEN)).isFalse();
  }

  @Test
  void cancel_target_tells_which_follow_up_steps_remain() {
    Order order = lockedBy(TOKEN);
    order.markConfirmed("261113-0004", 9L, now);
    order.markCanceled("CUSTOMER_CANCEL", now);
    when(orderRepository.findByIdAndUserId(100L, 7L)).thenReturn(Optional.of(order));

    var target = service.findCancelTarget(7L, 100L);
    assertThat(target.stockRestoreRemaining()).isTrue();
    assertThat(target.refundRemaining()).isTrue();

    order.markStockRestored(now);
    order.markRefunded(now);
    var done = service.findCancelTarget(7L, 100L);
    assertThat(done.stockRestoreRemaining()).isFalse();
    assertThat(done.refundRemaining()).isFalse();
  }

  @Test
  void orders_canceled_before_confirmation_have_no_follow_up_steps() {
    Order order = lockedBy(TOKEN);
    order.markCanceled("CUSTOMER_CANCEL", now);
    when(orderRepository.findByIdAndUserId(100L, 7L)).thenReturn(Optional.of(order));

    var target = service.findCancelTarget(7L, 100L);

    assertThat(target.stockRestoreRemaining()).isFalse();
    assertThat(target.refundRemaining()).isFalse();
  }

  @Test
  void confirm_issues_order_no_and_saves_outbox_event_in_same_call() throws Exception {
    Order order = lockedBy(TOKEN);
    when(orderRepository.findWithLockById(100L)).thenReturn(Optional.of(order));
    when(orderNoRepository.nextSequence(LocalDate.of(2026, 11, 13))).thenReturn(7);

    OrderDetailResponse response = service.confirmOrder(100L, TOKEN, 9L, menus());

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

    OrderDetailResponse response = service.confirmOrder(100L, TOKEN, 9L, menus());

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
