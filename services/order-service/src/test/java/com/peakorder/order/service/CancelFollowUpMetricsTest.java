package com.peakorder.order.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.peakorder.order.repository.OrderRepository;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.Test;

class CancelFollowUpMetricsTest {

  @Test
  void the_gauge_reports_how_many_canceled_orders_need_a_manual_check() {
    OrderRepository repository = mock(OrderRepository.class);
    SimpleMeterRegistry registry = new SimpleMeterRegistry();
    new CancelFollowUpMetrics(registry, repository);

    when(repository.countCancelFollowUpManual()).thenReturn(0L, 3L);

    assertThat(registry.get("order.cancel.follow.up.manual.required").gauge().value()).isZero();
    assertThat(registry.get("order.cancel.follow.up.manual.required").gauge().value())
        .isEqualTo(3.0);
  }
}
