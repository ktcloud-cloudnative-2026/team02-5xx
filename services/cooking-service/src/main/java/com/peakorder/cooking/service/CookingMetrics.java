package com.peakorder.cooking.service;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/**
 * Cooking 업무 Counter (docs/observability.md 2-2, #243). "지금 몇 개"를 보는 Gauge는 {@code
 * config.CookingMetricsConfig}에 있다.
 *
 * <p>Counter는 트랜잭션이 <b>커밋된 뒤에만</b> 올린다. 상태를 바꾼 뒤 예외로 롤백되면 실제로 일어나지 않은 일이므로 세지 않는다. 트랜잭션 밖(단위 테스트
 * 등)에서 호출되면 바로 올린다.
 *
 * <p>Prometheus에서는 점이 밑줄로 바뀌고 {@code _total}이 붙는다(예: {@code cooking.tickets.started} → {@code
 * cooking_tickets_started_total}). Counter는 누적값이라 {@code rate()}·{@code increase()}로 본다.
 */
@Component
public class CookingMetrics {

  static final String RESULT_CREATED = "created";
  static final String RESULT_DUPLICATE = "duplicate";

  private final Counter started;
  private final Counter completed;
  private final Counter canceled;
  private final Counter orderConfirmedCreated;
  private final Counter orderConfirmedDuplicate;

  public CookingMetrics(MeterRegistry registry) {
    this.started =
        Counter.builder("cooking.tickets.started")
            .description("조리를 시작한 전표 수 (WAITING → COOKING)")
            .register(registry);
    this.completed =
        Counter.builder("cooking.tickets.completed")
            .description("조리를 완료한 전표 수 (COOKING → DONE)")
            .register(registry);
    this.canceled =
        Counter.builder("cooking.tickets.canceled")
            .description("취소한 전표 수 (WAITING → CANCELED, 멱등 재요청 제외, CI-03)")
            .register(registry);
    this.orderConfirmedCreated = orderConfirmedCounter(registry, RESULT_CREATED);
    this.orderConfirmedDuplicate = orderConfirmedCounter(registry, RESULT_DUPLICATE);
  }

  private static Counter orderConfirmedCounter(MeterRegistry registry, String result) {
    return Counter.builder("cooking.order.confirmed.received")
        .description("받은 OrderConfirmed(EV-01) 수. duplicate는 같은 eventId 또는 같은 주문의 재수신")
        .tag("result", result)
        .register(registry);
  }

  void ticketStarted() {
    afterCommit(started::increment);
  }

  void ticketCompleted() {
    afterCommit(completed::increment);
  }

  void ticketCanceled() {
    afterCommit(canceled::increment);
  }

  void orderConfirmedCreated() {
    afterCommit(orderConfirmedCreated::increment);
  }

  void orderConfirmedDuplicate() {
    afterCommit(orderConfirmedDuplicate::increment);
  }

  private static void afterCommit(Runnable action) {
    if (TransactionSynchronizationManager.isSynchronizationActive()) {
      TransactionSynchronizationManager.registerSynchronization(
          new TransactionSynchronization() {
            @Override
            public void afterCommit() {
              action.run();
            }
          });
    } else {
      action.run();
    }
  }
}
