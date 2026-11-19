package com.peakorder.order.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Duration;
import org.junit.jupiter.api.Test;

class CancelFollowUpPolicyTest {

  private final CancelFollowUpPolicy policy =
      new CancelFollowUpPolicy(12, Duration.ofSeconds(30), Duration.ofHours(1));

  @Test
  void the_wait_doubles_with_each_failure_up_to_the_maximum() {
    assertThat(policy.delayAfter(0)).isEqualTo(Duration.ofSeconds(30));
    assertThat(policy.delayAfter(1)).isEqualTo(Duration.ofSeconds(60));
    assertThat(policy.delayAfter(2)).isEqualTo(Duration.ofSeconds(120));
    assertThat(policy.delayAfter(6)).isEqualTo(Duration.ofSeconds(1920));
    assertThat(policy.delayAfter(7)).isEqualTo(Duration.ofHours(1));
    assertThat(policy.delayAfter(50)).isEqualTo(Duration.ofHours(1));
  }

  @Test
  void the_default_limit_of_twelve_attempts_tolerates_hours_of_outage() {
    Duration total = Duration.ZERO;
    for (int failures = 0; failures < policy.maxAttempts() - 1; failures++) {
      total = total.plus(policy.delayAfter(failures));
    }

    assertThat(total).isBetween(Duration.ofHours(5), Duration.ofHours(6));
  }

  @Test
  void spring_builds_the_policy_with_the_defaults_and_with_overridden_settings() {
    org.springframework.boot.test.context.runner.ApplicationContextRunner runner =
        new org.springframework.boot.test.context.runner.ApplicationContextRunner()
            .withUserConfiguration(CancelFollowUpPolicy.class);

    runner.run(
        context -> {
          CancelFollowUpPolicy bean = context.getBean(CancelFollowUpPolicy.class);
          assertThat(bean.maxAttempts()).isEqualTo(12);
          assertThat(bean.delayAfter(0)).isEqualTo(Duration.ofSeconds(30));
        });
    runner
        .withPropertyValues(
            "cancel.follow-up.max-attempts=3",
            "cancel.follow-up.retry-base-sec=2",
            "cancel.follow-up.retry-max-sec=4")
        .run(
            context -> {
              CancelFollowUpPolicy bean = context.getBean(CancelFollowUpPolicy.class);
              assertThat(bean.maxAttempts()).isEqualTo(3);
              assertThat(bean.delayAfter(5)).isEqualTo(Duration.ofSeconds(4));
            });
  }

  @Test
  void a_limit_below_one_is_rejected() {
    assertThatThrownBy(
            () -> new CancelFollowUpPolicy(0, Duration.ofSeconds(30), Duration.ofHours(1)))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
