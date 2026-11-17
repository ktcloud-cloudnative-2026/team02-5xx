package com.peakorder.cooking.service;

import com.peakorder.cooking.entity.OutboxEvent;
import com.peakorder.cooking.messaging.EventPublisher;
import com.peakorder.cooking.repository.OutboxEventRepository;
import java.time.Clock;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * outbox에 쌓인 PENDING 이벤트를 발행하고 SENT로 바꾼다(Order #52와 같은 방식). 발행에 실패하면 그 이벤트부터는 PENDING으로 남겨 다음 주기에
 * 다시 시도한다(최소 한 번 전달 — 받는 쪽 Order가 eventId로 중복을 걸러낸다).
 */
@Service
public class OutboxRelayService {

  private static final Logger log = LoggerFactory.getLogger(OutboxRelayService.class);

  private final OutboxEventRepository outboxEventRepository;
  private final EventPublisher eventPublisher;
  private final Clock clock;
  private final int batchSize;

  public OutboxRelayService(
      OutboxEventRepository outboxEventRepository,
      EventPublisher eventPublisher,
      Clock clock,
      @Value("${events.outbox.batch-size:50}") int batchSize) {
    this.outboxEventRepository = outboxEventRepository;
    this.eventPublisher = eventPublisher;
    this.clock = clock;
    this.batchSize = batchSize;
  }

  /**
   * @return 이번 주기에 발행에 성공한 이벤트 수
   */
  @Transactional
  public int relayPending() {
    List<OutboxEvent> pending = outboxEventRepository.findPendingForUpdate(batchSize);
    int sent = 0;
    for (OutboxEvent event : pending) {
      try {
        eventPublisher.publish(event);
      } catch (RuntimeException e) {
        // 순서를 지키기 위해 실패한 이벤트 뒤의 것은 이번 주기에 보내지 않는다.
        log.warn(
            "이벤트 발행 실패, 다음 주기에 다시 시도 eventId={} type={}: {}",
            event.getEventId(),
            event.getEventType(),
            e.getMessage());
        break;
      }
      event.markSent(clock.instant());
      sent++;
    }
    return sent;
  }
}
