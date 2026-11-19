package com.peakorder.cooking.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** outbox 발행을 주기적으로 실행한다. `events.outbox.enabled=false`면 등록되지 않는다(테스트 환경). */
@Component
@ConditionalOnProperty(name = "events.outbox.enabled", havingValue = "true", matchIfMissing = true)
public class OutboxRelayScheduler {

  private static final Logger log = LoggerFactory.getLogger(OutboxRelayScheduler.class);

  private final OutboxRelayService relayService;

  public OutboxRelayScheduler(OutboxRelayService relayService) {
    this.relayService = relayService;
  }

  @Scheduled(fixedDelayString = "${events.outbox.poll-interval-ms:1000}")
  public void relay() {
    try {
      relayService.relayPending();
    } catch (RuntimeException e) {
      // DB 일시 장애 등. 다음 주기에 다시 시도한다.
      log.warn("outbox 발행 주기 실패, 다음 주기에 다시 시도합니다: {}", e.toString());
    }
  }
}
