package com.peakorder.order.messaging;

import com.peakorder.order.service.CookingCompletedService;
import java.nio.charset.StandardCharsets;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.stereotype.Component;
import tools.jackson.databind.json.JsonMapper;

/**
 * Cooking이 보낸 CookingCompleted를 받는다. 형식이 잘못되었거나 처리에 실패하면 예외를 던져 재시도하고, 계속 실패하면 DLQ에 보관된다. 정상 처리가 끝난
 * 뒤에만 ack 한다.
 */
@Component
public class CookingCompletedListener {

  private final JsonMapper jsonMapper;
  private final CookingCompletedService service;

  public CookingCompletedListener(JsonMapper jsonMapper, CookingCompletedService service) {
    this.jsonMapper = jsonMapper;
    this.service = service;
  }

  @RabbitListener(queues = "${events.cooking-completed.queue}")
  public void onMessage(Message message) {
    CookingCompletedEvent event =
        jsonMapper.readValue(
            new String(message.getBody(), StandardCharsets.UTF_8), CookingCompletedEvent.class);
    if (event.eventId() == null || event.orderId() == null) {
      throw new IllegalArgumentException("CookingCompleted에 eventId 또는 orderId가 없습니다.");
    }
    service.handle(event);
  }
}
