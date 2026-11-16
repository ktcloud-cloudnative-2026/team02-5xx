package com.peakorder.order.messaging;

import com.peakorder.order.repository.OutboxEventRepository.PendingEvent;

/** outbox에 저장된 이벤트를 브로커로 내보낸다. */
public interface EventPublisher {

  /** 브로커가 받았음을 확인할 때까지 기다린다. 확인하지 못하면 예외를 던진다. */
  void publish(PendingEvent event);
}
