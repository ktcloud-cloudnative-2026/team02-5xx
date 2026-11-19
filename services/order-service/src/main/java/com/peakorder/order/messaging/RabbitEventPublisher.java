package com.peakorder.order.messaging;

import com.peakorder.order.repository.OutboxEventRepository.PendingEvent;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.core.MessageBuilder;
import org.springframework.amqp.core.MessageDeliveryMode;
import org.springframework.amqp.rabbit.connection.CorrelationData;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * RabbitMQ 발행. 브로커 확인(publisher confirm)과 반환(라우팅 실패)을 모두 확인한 뒤에만 성공으로 본다. 큐에 바인딩되지 않아 되돌아온 메시지는 실패로
 * 취급해 outbox에 남긴다.
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
      @Value("${events.order-confirmed.routing-key}") String orderConfirmedRoutingKey) {
    this.rabbitTemplate = rabbitTemplate;
    this.exchange = exchange;
    this.routingKeys = Map.of(OrderConfirmedEvent.EVENT_TYPE, orderConfirmedRoutingKey);
  }

  @Override
  public void publish(PendingEvent event) {
    String routingKey = routingKeys.get(event.eventType());
    if (routingKey == null) {
      throw new IllegalArgumentException("발행할 수 없는 이벤트 유형입니다: " + event.eventType());
    }
    Message message =
        MessageBuilder.withBody(event.payload().getBytes(StandardCharsets.UTF_8))
            .setContentType("application/json")
            .setContentEncoding("UTF-8")
            .setMessageId(event.eventId().toString())
            .setDeliveryMode(MessageDeliveryMode.PERSISTENT)
            .setHeader("eventType", event.eventType())
            .build();
    CorrelationData correlation = new CorrelationData(event.eventId().toString());
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
    } catch (java.util.concurrent.ExecutionException | java.util.concurrent.TimeoutException e) {
      throw new IllegalStateException("발행 확인을 받지 못했습니다.", e);
    }
    if (correlation.getReturned() != null) {
      throw new IllegalStateException("라우팅할 큐가 없어 메시지가 반환되었습니다(바인딩 필요).");
    }
  }
}
