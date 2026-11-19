package com.peakorder.order.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.peakorder.order.exception.BusinessException;
import com.peakorder.order.exception.ErrorCode;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.Test;

class CookingAvailabilityTest {

  private final SimpleMeterRegistry registry = new SimpleMeterRegistry();
  private final CookingAvailability availability = new CookingAvailability(registry, 3);

  private double gauge() {
    return registry.get("order.cooking.available").gauge().value();
  }

  @Test
  void starts_available_so_a_restart_does_not_block_orders() {
    assertThat(availability.isAvailable()).isTrue();
    availability.ensureAvailable();
    assertThat(gauge()).isEqualTo(1.0);
  }

  @Test
  void one_or_two_failures_do_not_block() {
    availability.recordFailure();
    availability.recordFailure();

    assertThat(availability.isAvailable()).isTrue();
  }

  @Test
  void three_consecutive_failures_block_with_503_cooking_unavailable() {
    availability.recordFailure();
    availability.recordFailure();
    availability.recordFailure();

    assertThat(availability.isAvailable()).isFalse();
    assertThat(gauge()).isEqualTo(0.0);
    assertThatThrownBy(availability::ensureAvailable)
        .isInstanceOfSatisfying(
            BusinessException.class,
            e -> {
              assertThat(e.errorCode()).isEqualTo(ErrorCode.COOKING_UNAVAILABLE);
              assertThat(e.errorCode().status().value()).isEqualTo(503);
            });
  }

  @Test
  void a_single_success_releases_the_block_immediately() {
    for (int i = 0; i < 5; i++) {
      availability.recordFailure();
    }
    assertThat(availability.isAvailable()).isFalse();

    availability.recordSuccess();

    assertThat(availability.isAvailable()).isTrue();
    assertThat(gauge()).isEqualTo(1.0);
    availability.ensureAvailable();
  }

  @Test
  void failures_must_be_consecutive_a_success_in_between_resets_the_count() {
    availability.recordFailure();
    availability.recordFailure();
    availability.recordSuccess();
    availability.recordFailure();
    availability.recordFailure();

    assertThat(availability.isAvailable()).isTrue();
  }
}
