package com.peakorder.order.messaging;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

import com.peakorder.order.repository.OutboxEventRepository.PendingEvent;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.core.MessageDeliveryMode;
import org.springframework.amqp.rabbit.connection.CorrelationData;
import org.springframework.amqp.rabbit.core.RabbitTemplate;

class RabbitEventPublisherTest {

  private final RabbitTemplate template = mock(RabbitTemplate.class);
  private final RabbitEventPublisher publisher =
      new RabbitEventPublisher(template, "peakorder.events", "order.confirmed");
  private final PendingEvent event =
      new PendingEvent(1L, UUID.randomUUID(), "OrderConfirmed", "{\"orderId\":1}");

  private void brokerResponds(boolean ack, boolean returned) {
    doAnswer(
            inv -> {
              CorrelationData cd = inv.getArgument(3);
              if (returned) {
                cd.setReturned(mock(org.springframework.amqp.core.ReturnedMessage.class));
              }
              cd.getFuture().complete(new CorrelationData.Confirm(ack, ack ? null : "nack"));
              return null;
            })
        .when(template)
        .send(any(String.class), any(String.class), any(Message.class), any(CorrelationData.class));
  }

  @Test
  void sends_persistent_json_message_with_event_id_to_routing_key() {
    brokerResponds(true, false);

    publisher.publish(event);

    ArgumentCaptor<Message> message = ArgumentCaptor.forClass(Message.class);
    verify(template).send(eq("peakorder.events"), eq("order.confirmed"), message.capture(), any());
    assertThat(new String(message.getValue().getBody(), StandardCharsets.UTF_8))
        .isEqualTo("{\"orderId\":1}");
    assertThat(message.getValue().getMessageProperties().getMessageId())
        .isEqualTo(event.eventId().toString());
    assertThat(message.getValue().getMessageProperties().getDeliveryMode())
        .isEqualTo(MessageDeliveryMode.PERSISTENT);
    assertThat(message.getValue().getMessageProperties().getContentType())
        .isEqualTo("application/json");
  }

  @Test
  void broker_nack_is_a_failure() {
    brokerResponds(false, false);

    assertThatThrownBy(() -> publisher.publish(event)).isInstanceOf(IllegalStateException.class);
  }

  @Test
  void unroutable_returned_message_is_a_failure_so_it_stays_in_outbox() {
    brokerResponds(true, true);

    assertThatThrownBy(() -> publisher.publish(event))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("라우팅");
  }

  @Test
  void unknown_event_type_is_rejected() {
    PendingEvent unknown = new PendingEvent(2L, UUID.randomUUID(), "Other", "{}");

    assertThatThrownBy(() -> publisher.publish(unknown))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
