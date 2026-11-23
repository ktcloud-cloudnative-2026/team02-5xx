package com.peakorder.cooking.config;

import com.peakorder.cooking.entity.TicketStatus;
import com.peakorder.cooking.repository.CookingTicketRepository;
import com.peakorder.cooking.repository.OutboxEventRepository;
import com.peakorder.cooking.service.CookingDashboardService;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.binder.MeterBinder;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Cooking 업무 Gauge (docs/observability.md 2-2, #243). Prometheus가 수집할 때마다 DB를 조회해 "지금 몇 개"를 보여 준다.
 * 횟수를 세는 Counter는 {@code service.CookingMetrics}에 있다.
 *
 * <ul>
 *   <li>모든 쿼리는 인덱스를 탄다: 상태별 개수는 {@code idx_cooking_tickets_status_queued_at}, Outbox는 부분 인덱스 {@code
 *       idx_outbox_events_pending}.
 *   <li>Pod마다 같은 DB를 세므로 알림·대시보드에서는 {@code max}로 본다(2-1).
 *   <li>DB 조회가 실패하면 값이 NaN이 된다 — 알림 감시 한계(4-2)에 적힌 후속 과제.
 * </ul>
 */
@Configuration
public class CookingMetricsConfig {

  @Bean
  MeterBinder cookingGauges(
      CookingTicketRepository ticketRepository,
      OutboxEventRepository outboxEventRepository,
      CookingDashboardService dashboardService) {
    return registry -> {
      ticketGauge(registry, ticketRepository, TicketStatus.WAITING);
      ticketGauge(registry, ticketRepository, TicketStatus.COOKING);
      Gauge.builder(
              "cooking.expected.wait", dashboardService, CookingDashboardService::expectedWaitSec)
          .description("지금 주문하면 조리 시작까지 예상 대기(CO-01과 같은 계산)")
          .baseUnit("seconds")
          .register(registry);
      Gauge.builder(
              "cooking.outbox.pending", outboxEventRepository, OutboxEventRepository::countPending)
          .description("발행 대기(PENDING) CookingCompleted(EV-02) 수. 정상이면 1초 안에 0")
          .register(registry);
    };
  }

  private static void ticketGauge(
      MeterRegistry registry, CookingTicketRepository repository, TicketStatus status) {
    Gauge.builder("cooking.tickets", repository, r -> r.countByStatus(status))
        .description("상태별 조리 전표 수 (지금 주방이 얼마나 밀렸나)")
        .tag("status", status.name().toLowerCase())
        .register(registry);
  }
}
