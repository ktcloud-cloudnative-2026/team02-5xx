package com.peakorder.order.messaging;

import com.peakorder.order.repository.OutboxEventRepository;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.stereotype.Component;

/**
 * 발행 대기(PENDING) outbox 이벤트 수 지표(docs/observability.md 2-2, #272). Prometheus에서는 {@code
 * order_outbox_pending}으로 보인다. 정상이면 outbox 발행기가 1초 안에 비우므로 0이고, 계속 남아 있으면 OrderConfirmed(EV-01) 발행이
 * 막혀 Cooking이 주문을 받지 못하고 있다는 뜻이다(알림 4-2의 5번, 규칙은 모니터링 담당과 정한다).
 *
 * <p>수집(scrape)마다 DB를 한 번 조회한다. 쿼리는 부분 인덱스 {@code idx_outbox_events_pending}을 탄다. Pod마다 같은 DB를 세므로
 * 알림· 대시보드에서는 {@code max}로 본다(2-1). DB 조회가 실패하면 값이 NaN이 된다 — 알림 감시 한계(4-2)에 적힌 후속 과제.
 */
@Component
public class OutboxMetrics {

  public OutboxMetrics(MeterRegistry meterRegistry, OutboxEventRepository outboxEventRepository) {
    Gauge.builder(
            "order.outbox.pending", outboxEventRepository, OutboxEventRepository::countPending)
        .description("발행 대기(PENDING) OrderConfirmed(EV-01) 수. 정상이면 1초 안에 0")
        .register(meterRegistry);
  }
}
