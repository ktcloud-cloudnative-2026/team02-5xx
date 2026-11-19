package com.peakorder.cooking.config;

import static org.assertj.core.api.Assertions.assertThat;

import com.peakorder.cooking.repository.CongestionThresholdRepository;
import com.peakorder.cooking.repository.CookingTicketRepository;
import com.peakorder.cooking.repository.OutboxEventRepository;
import com.peakorder.cooking.repository.ProcessedEventRepository;
import com.peakorder.cooking.service.CookingProgressService;
import com.peakorder.cooking.service.OutboxRelayService;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/**
 * outbox 발행이 RabbitMQ 확인을 기다리며 멈춰 있어도 자동 조리 진행은 계속 실행되는지 확인한다(PR #78 리뷰). 두 스케줄러를 켜고 주기를 100ms로 줄인
 * 뒤, 발행 작업만 붙잡아 둔다.
 *
 * <p>스케줄러는 컨텍스트가 뜨자마자 다른 스레드에서 실행되므로, 테스트 메서드에서 Mockito로 동작을 정하면 호출과 겹쳐 실패할 수 있다. 그래서 동작이 처음부터 정해진
 * 가짜 Bean을 쓴다.
 */
@SpringBootTest(
    properties = {
      "cooking.progress.enabled=true",
      "cooking.progress.interval-ms=100",
      "events.outbox.enabled=true",
      "events.outbox.poll-interval-ms=100"
    })
class SchedulerIsolationTest {

  static final AtomicInteger PROGRESS_CALLS = new AtomicInteger();
  static final CountDownLatch RELAY_STARTED = new CountDownLatch(1);
  static final CountDownLatch RELEASE_RELAY = new CountDownLatch(1);

  @MockitoBean CookingTicketRepository cookingTicketRepository;
  @MockitoBean OutboxEventRepository outboxEventRepository;
  @MockitoBean ProcessedEventRepository processedEventRepository;
  @MockitoBean CongestionThresholdRepository congestionThresholdRepository;

  @TestConfiguration
  static class FakeSchedulerTargets {

    /** 자동 조리 진행: 호출 횟수만 센다 */
    @Bean
    @Primary
    CookingProgressService fakeProgressService() {
      return new CookingProgressService(null, null, null, null) {
        @Override
        public void tick() {
          PROGRESS_CALLS.incrementAndGet();
        }
      };
    }

    /** outbox 발행: RabbitMQ 확인 대기를 흉내 내 풀어 줄 때까지 붙잡혀 있는다 */
    @Bean
    @Primary
    OutboxRelayService fakeRelayService() {
      return new OutboxRelayService(null, null, null, 50) {
        @Override
        public int relayPending() {
          RELAY_STARTED.countDown();
          try {
            RELEASE_RELAY.await(5, TimeUnit.SECONDS);
          } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
          }
          return 0;
        }
      };
    }
  }

  @AfterAll
  static void release() {
    RELEASE_RELAY.countDown();
  }

  @Test
  void 발행이_멈춰_있어도_자동_조리_진행은_계속된다() throws Exception {
    assertThat(RELAY_STARTED.await(3, TimeUnit.SECONDS)).as("발행 작업 시작").isTrue();
    int before = PROGRESS_CALLS.get();

    Thread.sleep(1200);

    assertThat(PROGRESS_CALLS.get() - before)
        .as("발행이 막힌 1.2초 동안 자동 조리 진행 실행 횟수")
        .isGreaterThanOrEqualTo(5);
  }
}
