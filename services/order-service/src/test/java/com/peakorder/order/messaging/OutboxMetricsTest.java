package com.peakorder.order.messaging;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.peakorder.order.repository.OutboxEventRepository;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.Test;

class OutboxMetricsTest {

  @Test
  void the_gauge_reports_how_many_outbox_events_are_waiting_to_be_published() {
    OutboxEventRepository repository = mock(OutboxEventRepository.class);
    SimpleMeterRegistry registry = new SimpleMeterRegistry();
    new OutboxMetrics(registry, repository);

    // 수집(scrape)할 때마다 저장소를 다시 조회해 "지금 몇 건"을 보여 준다
    when(repository.countPending()).thenReturn(0L, 4L);

    assertThat(registry.get("order.outbox.pending").gauge().value()).isZero();
    assertThat(registry.get("order.outbox.pending").gauge().value()).isEqualTo(4.0);
  }

  @Test
  void the_gauge_has_no_labels_because_the_count_is_not_split_by_any_value() {
    OutboxEventRepository repository = mock(OutboxEventRepository.class);
    SimpleMeterRegistry registry = new SimpleMeterRegistry();
    new OutboxMetrics(registry, repository);

    Gauge gauge = registry.get("order.outbox.pending").gauge();

    assertThat(gauge.getId().getTags()).isEmpty();
    assertThat(gauge.getId().getDescription()).contains("OrderConfirmed");
  }
}
