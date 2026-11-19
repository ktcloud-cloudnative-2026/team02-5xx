package com.peakorder.order.service;

import com.peakorder.order.repository.OrderRepository;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.stereotype.Component;

/**
 * 수동 확인이 필요한 취소 주문 수 지표. 환불·재고 복원이 상한까지 재시도하고도 끝나지 않았거나 다시 호출해도 결과가 같은 오류로 끝난 주문이다. Prometheus에서는
 * {@code order_cancel_follow_up_manual_required}로 보이며, 0보다 크면 사람이 확인해야 한다(알림 규칙은 모니터링 담당과 정한다).
 */
@Component
public class CancelFollowUpMetrics {

  public CancelFollowUpMetrics(MeterRegistry meterRegistry, OrderRepository orderRepository) {
    Gauge.builder(
            "order.cancel.follow.up.manual.required",
            orderRepository,
            OrderRepository::countCancelFollowUpManual)
        .description("수동 확인이 필요한 취소 주문 수(환불·재고 복원 미완료)")
        .register(meterRegistry);
  }
}
