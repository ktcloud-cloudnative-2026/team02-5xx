package com.peakorder.cooking.messaging;

import com.peakorder.cooking.entity.OutboxEvent;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.core.MessageBuilder;
import org.springframework.amqp.core.MessageDeliveryMode;
import org.springframework.amqp.rabbit.connection.CorrelationData;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * RabbitMQ 발행 (Order #52와 같은 방식). 브로커 확인(publisher confirm)과 반환(라우팅 실패)을 모두 확인한 뒤에만 성공으로 본다. 큐에
 * 바인딩되지 않아 되돌아온 메시지는 실패로 취급해 outbox에 PENDING으로 남긴다.
 *
 * <p>메시지: JSON 본문(outbox payload 그대로), persistent, messageId = eventId, contentType =
 * application/json
 */
@Component
public class RabbitEventPublisher implements EventPublisher {

  private static final long CONFIRM_TIMEOUT_SECONDS = 5;

  private final RabbitTemplate rabbitTemplate;
  private final String exchange;
  private final Map<String, String> routingKeys;

  public RabbitEventPublisher(
      RabbitTemplate rabbitTemplate,
      @Value("${events.exchange}") String exchange,
      @Value("${events.cooking-completed.routing-key}") String cookingCompletedRoutingKey) {
    this.rabbitTemplate = rabbitTemplate;
    this.exchange = exchange;
    this.routingKeys = Map.of(CookingCompletedEvent.EVENT_TYPE, cookingCompletedRoutingKey);
  }

  @Override
  public void publish(OutboxEvent event) {
    String routingKey = routingKeys.get(event.getEventType());
    if (routingKey == null) {
      throw new IllegalArgumentException("발행할 수 없는 이벤트 유형입니다: " + event.getEventType());
    }
    Message message =
        MessageBuilder.withBody(event.getPayload().getBytes(StandardCharsets.UTF_8))
            .setContentType("application/json")
            .setContentEncoding("UTF-8")
            .setMessageId(event.getEventId().toString())
            .setDeliveryMode(MessageDeliveryMode.PERSISTENT)
            .setHeader("eventType", event.getEventType())
            .build();
    CorrelationData correlation = new CorrelationData(event.getEventId().toString());
    rabbitTemplate.send(exchange, routingKey, message, correlation);
    try {
      CorrelationData.Confirm confirm =
          correlation.getFuture().get(CONFIRM_TIMEOUT_SECONDS, TimeUnit.SECONDS);
      if (!confirm.ack()) {
        throw new IllegalStateException("브로커가 메시지를 거부했습니다: " + confirm.reason());
      }
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      throw new IllegalStateException("발행 확인 대기 중 중단되었습니다.", e);
    } catch (ExecutionException | TimeoutException e) {
      throw new IllegalStateException("발행 확인을 받지 못했습니다.", e);
    }
    if (correlation.getReturned() != null) {
      throw new IllegalStateException("라우팅할 큐가 없어 메시지가 반환되었습니다(바인딩 필요).");
    }
  }
}
