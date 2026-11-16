package com.peakorder.order.messaging;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
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
      log.warn("outbox 발행 주기 실패", e);
    }
  }
}
