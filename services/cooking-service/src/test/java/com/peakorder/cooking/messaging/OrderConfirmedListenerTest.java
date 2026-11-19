package com.peakorder.cooking.messaging;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

import com.peakorder.cooking.service.OrderConfirmedService;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.core.MessageProperties;
import org.springframework.dao.DataAccessResourceFailureException;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.json.JsonMapper;

class OrderConfirmedListenerTest {

  private OrderConfirmedService service;
  private OrderConfirmedListener listener;

  @BeforeEach
  void setUp() {
    service = mock(OrderConfirmedService.class);
    listener = new OrderConfirmedListener(JsonMapper.builder().build(), service);
  }

  private static Message message(String json) {
    return new Message(json.getBytes(StandardCharsets.UTF_8), new MessageProperties());
  }

  @Test
  void 합의된_본문을_읽어_서비스에_넘긴다() {
    String json =
        """
        {"eventId":"2648836b-8311-40ff-9fbd-4b6081a5efe3","orderId":1,"orderNo":"261116-0001",
         "userId":7,"confirmedAt":"2026-11-16T10:16:19.305+09:00",
         "items":[{"menuId":1,"menuName":"아메리카노","quantity":2,"cookTimeSec":120,
                   "options":[{"optionId":10,"optionName":"샷 추가","extraCookTimeSec":30}]}]}
        """;

    listener.onMessage(message(json));

    verify(service).handle(any(OrderConfirmedEvent.class));
  }

  @Test
  void 깨진_JSON은_재시도하지_않는_오류다() {
    assertThatThrownBy(() -> listener.onMessage(message("{not json")))
        .isInstanceOf(JacksonException.class)
        .satisfies(e -> assertThat(ListenerRetryPolicy.isRetryable(e)).isFalse());
    verify(service, never()).handle(any());
  }

  @Test
  void 필수값이_없으면_재시도하지_않는_오류다() {
    assertThatThrownBy(() -> listener.onMessage(message("{\"orderId\":1}")))
        .isInstanceOf(IllegalArgumentException.class)
        .satisfies(e -> assertThat(ListenerRetryPolicy.isRetryable(e)).isFalse());
  }

  @Test
  void 항목이_비어_있으면_거절한다() {
    OrderConfirmedEvent event =
        new OrderConfirmedEvent(UUID.randomUUID(), 1L, "261116-0001", 7L, null, List.of());

    assertThatThrownBy(() -> OrderConfirmedListener.validate(event))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void DB_연결_같은_일시_오류는_재시도한다() {
    assertThat(ListenerRetryPolicy.isRetryable(new DataAccessResourceFailureException("db down")))
        .isTrue();
  }
}
