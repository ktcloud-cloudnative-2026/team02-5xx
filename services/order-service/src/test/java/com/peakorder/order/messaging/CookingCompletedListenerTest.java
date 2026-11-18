package com.peakorder.order.messaging;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

import com.peakorder.order.service.CookingCompletedService;
import java.nio.charset.StandardCharsets;
import java.time.OffsetDateTime;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.core.MessageBuilder;
import tools.jackson.databind.json.JsonMapper;

class CookingCompletedListenerTest {

  private final CookingCompletedService service = mock(CookingCompletedService.class);
  private final CookingCompletedListener listener =
      new CookingCompletedListener(JsonMapper.builder().build(), service);

  private Message body(String json) {
    return MessageBuilder.withBody(json.getBytes(StandardCharsets.UTF_8)).build();
  }

  @Test
  void valid_message_is_passed_to_service() {
    UUID eventId = UUID.randomUUID();

    listener.onMessage(
        body(
            "{\"eventId\":\"%s\",\"orderId\":5,\"completedAt\":\"2026-11-16T10:30:00+09:00\"}"
                .formatted(eventId)));

    ArgumentCaptor<CookingCompletedEvent> event =
        ArgumentCaptor.forClass(CookingCompletedEvent.class);
    verify(service).handle(event.capture());
    assertThat(event.getValue().eventId()).isEqualTo(eventId);
    assertThat(event.getValue().orderId()).isEqualTo(5L);
    assertThat(event.getValue().completedAt())
        .isEqualTo(OffsetDateTime.parse("2026-11-16T10:30:00+09:00"));
  }

  @Test
  void malformed_json_throws_so_it_is_retried_and_dead_lettered() {
    assertThatThrownBy(() -> listener.onMessage(body("not-json")))
        .isInstanceOf(RuntimeException.class);
    verify(service, never()).handle(org.mockito.ArgumentMatchers.any());
  }

  @Test
  void message_without_ids_throws() {
    assertThatThrownBy(() -> listener.onMessage(body("{\"orderId\":5}")))
        .isInstanceOf(RuntimeException.class);
    verify(service, never()).handle(org.mockito.ArgumentMatchers.any());
  }
}
