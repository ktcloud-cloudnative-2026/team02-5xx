package com.peakorder.order.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

import com.peakorder.order.client.CookingHealthClient;
import com.peakorder.order.messaging.OutboxRelayScheduler;
import com.peakorder.order.messaging.OutboxRelayService;
import com.peakorder.order.service.CookingAvailability;
import com.peakorder.order.service.CookingHealthChecker;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.PropertySource;
import org.springframework.scheduling.annotation.EnableScheduling;

/**
 * outbox 발행이 RabbitMQ 확인을 기다리며 멈춰 있어도 Cooking 헬스 점검이 계속 실행되는지 확인한다(PR #56 리뷰). 실제 스케줄러 Bean({@link
 * OutboxRelayScheduler}, {@link CookingHealthChecker})과 실제 스케줄러 설정({@link SchedulingConfig})을 쓰고,
 * 발행 쪽만 풀어 줄 때까지 붙잡아 둔다.
 */
class SchedulerIsolationTest {

  static final AtomicInteger HEALTH_CALLS = new AtomicInteger();
  static final CountDownLatch RELAY_STARTED = new CountDownLatch(1);
  static final CountDownLatch RELEASE_RELAY = new CountDownLatch(1);

  @Configuration
  @EnableScheduling
  @Import(SchedulingConfig.class)
  @PropertySource("classpath:scheduler-isolation.properties")
  static class Targets {

    /** 발행: RabbitMQ 확인 대기를 흉내 내 풀어 줄 때까지 붙잡혀 있는다 */
    @Bean
    OutboxRelayService relayService() {
      return new OutboxRelayService(null, null, null, 50) {
        @Override
        public int relayPending() {
          RELAY_STARTED.countDown();
          try {
            RELEASE_RELAY.await(10, TimeUnit.SECONDS);
          } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
          }
          return 0;
        }
      };
    }

    @Bean
    OutboxRelayScheduler relayScheduler(OutboxRelayService relayService) {
      return new OutboxRelayScheduler(relayService);
    }

    /** 헬스 점검: 호출 횟수만 센다 */
    @Bean
    CookingHealthChecker healthChecker() {
      CookingHealthClient client =
          () -> {
            HEALTH_CALLS.incrementAndGet();
            return true;
          };
      return new CookingHealthChecker(client, mock(CookingAvailability.class));
    }
  }

  @Test
  void relay_blocked_on_publisher_confirm_does_not_delay_cooking_health_checks() throws Exception {
    try (AnnotationConfigApplicationContext context =
        new AnnotationConfigApplicationContext(Targets.class)) {
      assertThat(RELAY_STARTED.await(3, TimeUnit.SECONDS)).as("발행 작업 시작").isTrue();
      int before = HEALTH_CALLS.get();

      Thread.sleep(1200);

      assertThat(HEALTH_CALLS.get() - before)
          .as("발행이 막힌 1.2초 동안 Cooking 헬스 점검 실행 횟수(주기 100ms)")
          .isGreaterThanOrEqualTo(5);
    } finally {
      RELEASE_RELAY.countDown();
    }
  }

  @Test
  void scheduler_has_one_thread_per_scheduled_job() {
    assertThat(SchedulingConfig.POOL_SIZE).isGreaterThanOrEqualTo(2);
  }
}
