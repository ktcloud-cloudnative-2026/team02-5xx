package com.peakorder.cooking.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.peakorder.cooking.entity.TicketStatus;
import com.peakorder.cooking.repository.CookingTicketRepository;
import com.peakorder.cooking.repository.OutboxEventRepository;
import com.peakorder.cooking.service.CookingDashboardService;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** Gauge 이름·라벨·값이 docs/observability.md 2-2와 맞는지 (#243). */
class CookingMetricsConfigTest {

  private CookingTicketRepository ticketRepository;
  private OutboxEventRepository outboxEventRepository;
  private CookingDashboardService dashboardService;
  private SimpleMeterRegistry registry;

  @BeforeEach
  void setUp() {
    ticketRepository = mock(CookingTicketRepository.class);
    outboxEventRepository = mock(OutboxEventRepository.class);
    dashboardService = mock(CookingDashboardService.class);
    registry = new SimpleMeterRegistry();
    new CookingMetricsConfig()
        .cookingGauges(ticketRepository, outboxEventRepository, dashboardService)
        .bindTo(registry);
  }

  @Test
  void 상태별_전표_수를_status_라벨로_보여_준다() {
    when(ticketRepository.countByStatus(TicketStatus.WAITING)).thenReturn(3L);
    when(ticketRepository.countByStatus(TicketStatus.COOKING)).thenReturn(1L);

    assertThat(registry.get("cooking.tickets").tag("status", "waiting").gauge().value())
        .isEqualTo(3);
    assertThat(registry.get("cooking.tickets").tag("status", "cooking").gauge().value())
        .isEqualTo(1);
  }

  @Test
  void 예상_대기는_CO_01과_같은_계산을_초_단위로_보여_준다() {
    when(dashboardService.expectedWaitSec()).thenReturn(420L);

    var gauge = registry.get("cooking.expected.wait").gauge();

    assertThat(gauge.value()).isEqualTo(420);
    assertThat(gauge.getId().getBaseUnit()).isEqualTo("seconds");
  }

  @Test
  void 발행_대기_Outbox_수를_보여_준다() {
    when(outboxEventRepository.countPending()).thenReturn(2L);

    assertThat(registry.get("cooking.outbox.pending").gauge().value()).isEqualTo(2);
  }
}
