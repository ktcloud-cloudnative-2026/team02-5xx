package com.peakorder.cooking.messaging;

import com.peakorder.cooking.service.OrderConfirmedService;
import java.nio.charset.StandardCharsets;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.stereotype.Component;
import tools.jackson.databind.json.JsonMapper;

/**
 * Order가 보낸 OrderConfirmed를 받는다. 형식 오류·필수값 누락은 재시도 없이 DLQ로, 일시적인 처리 실패는 재시도 후 DLQ로
 * 보낸다(RabbitConfig). 정상 처리가 끝난 뒤에만 ack 한다.
 */
@Component
public class OrderConfirmedListener {

  private final JsonMapper jsonMapper;
  private final OrderConfirmedService service;

  public OrderConfirmedListener(JsonMapper jsonMapper, OrderConfirmedService service) {
    this.jsonMapper = jsonMapper;
    this.service = service;
  }

  @RabbitListener(queues = "${events.order-confirmed.queue}")
  public void onMessage(Message message) {
    OrderConfirmedEvent event =
        jsonMapper.readValue(
            new String(message.getBody(), StandardCharsets.UTF_8), OrderConfirmedEvent.class);
    validate(event);
    service.handle(event);
  }

  static void validate(OrderConfirmedEvent event) {
    if (event.eventId() == null || event.orderId() == null) {
      throw new IllegalArgumentException("OrderConfirmed에 eventId 또는 orderId가 없습니다.");
    }
    if (event.orderNo() == null || event.orderNo().isBlank()) {
      throw new IllegalArgumentException(
          "OrderConfirmed에 orderNo가 없습니다. orderId=" + event.orderId());
    }
    if (event.items() == null || event.items().isEmpty()) {
      throw new IllegalArgumentException("OrderConfirmed에 주문 항목이 없습니다. orderId=" + event.orderId());
    }
  }
}
