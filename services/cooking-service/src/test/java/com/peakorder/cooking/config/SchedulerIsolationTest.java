package com.peakorder.cooking.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.doAnswer;

import com.peakorder.cooking.repository.CongestionThresholdRepository;
import com.peakorder.cooking.repository.CookingTicketRepository;
import com.peakorder.cooking.repository.OutboxEventRepository;
import com.peakorder.cooking.repository.ProcessedEventRepository;
import com.peakorder.cooking.service.CookingProgressService;
import com.peakorder.cooking.service.OutboxRelayService;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/**
 * outbox 발행이 RabbitMQ 확인을 기다리며 멈춰 있어도 자동 조리 진행은 계속 실행되는지 확인한다(PR #78 리뷰). 두 스케줄러를 켜고 주기를 100ms로 줄인
 * 뒤, 발행 작업만 붙잡아 둔다.
 */
@SpringBootTest(
    properties = {
      "cooking.progress.enabled=true",
      "cooking.progress.interval-ms=100",
      "events.outbox.enabled=true",
      "events.outbox.poll-interval-ms=100"
    })
class SchedulerIsolationTest {

  @MockitoBean CookingTicketRepository cookingTicketRepository;
  @MockitoBean OutboxEventRepository outboxEventRepository;
  @MockitoBean ProcessedEventRepository processedEventRepository;
  @MockitoBean CongestionThresholdRepository congestionThresholdRepository;
  @MockitoBean CookingProgressService progressService;
  @MockitoBean OutboxRelayService relayService;

  private final CountDownLatch releaseRelay = new CountDownLatch(1);

  @AfterEach
  void release() {
    releaseRelay.countDown();
  }

  @Test
  void 발행이_멈춰_있어도_자동_조리_진행은_계속된다() throws Exception {
    CountDownLatch relayStarted = new CountDownLatch(1);
    doAnswer(
            inv -> {
              relayStarted.countDown();
              releaseRelay.await(5, TimeUnit.SECONDS); // RabbitMQ 확인 대기를 흉내
              return 0;
            })
        .when(relayService)
        .relayPending();
    AtomicInteger progressCalls = new AtomicInteger();
    doAnswer(
            inv -> {
              progressCalls.incrementAndGet();
              return null;
            })
        .when(progressService)
        .tick();

    assertThat(relayStarted.await(3, TimeUnit.SECONDS)).isTrue();
    int before = progressCalls.get();
    Thread.sleep(1200);

    assertThat(progressCalls.get() - before)
        .as("발행이 막힌 1.2초 동안 자동 조리 진행 실행 횟수")
        .isGreaterThanOrEqualTo(5);
  }
}
