package com.peakorder.cooking.config;

import com.peakorder.cooking.messaging.ListenerRetryPolicy;
import java.util.Map;
import org.springframework.amqp.core.Binding;
import org.springframework.amqp.core.BindingBuilder;
import org.springframework.amqp.core.DirectExchange;
import org.springframework.amqp.core.Queue;
import org.springframework.amqp.core.QueueBuilder;
import org.springframework.amqp.core.TopicExchange;
import org.springframework.amqp.rabbit.config.ContainerCustomizer;
import org.springframework.amqp.rabbit.config.RetryInterceptorBuilder;
import org.springframework.amqp.rabbit.listener.SimpleMessageListenerContainer;
import org.springframework.amqp.rabbit.retry.RejectAndDontRequeueRecoverer;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * RabbitMQ 교환기·큐 선언 (Order #51과 합의한 계약).
 *
 * <p>교환기와 DLX는 Order와 같은 이름·속성으로 선언해야 한다(다르면 PRECONDITION_FAILED로 기동 실패). Cooking은 자기가 받는 큐
 * (OrderConfirmed)와 그 DLQ를 선언한다. 큐의 dead-letter 인자는 처음 만들 때부터 있어야 하며, 나중에 바꾸면 기존 큐를 지우고 다시 만들어야 한다.
 */
@Configuration
public class RabbitConfig {

  @Bean
  public TopicExchange eventsExchange(@Value("${events.exchange}") String name) {
    return new TopicExchange(name, true, false);
  }

  @Bean
  public DirectExchange deadLetterExchange(@Value("${events.dead-letter-exchange}") String name) {
    return new DirectExchange(name, true, false);
  }

  @Bean
  public Queue orderConfirmedQueue(
      @Value("${events.order-confirmed.queue}") String queue,
      @Value("${events.dead-letter-exchange}") String deadLetterExchange) {
    return QueueBuilder.durable(queue)
        .withArguments(
            Map.of(
                "x-dead-letter-exchange", deadLetterExchange,
                "x-dead-letter-routing-key", queue))
        .build();
  }

  @Bean
  public Queue orderConfirmedDeadLetterQueue(
      @Value("${events.order-confirmed.queue}") String queue) {
    return QueueBuilder.durable(queue + ".dlq").build();
  }

  @Bean
  public Binding orderConfirmedBinding(
      Queue orderConfirmedQueue,
      TopicExchange eventsExchange,
      @Value("${events.order-confirmed.routing-key}") String routingKey) {
    return BindingBuilder.bind(orderConfirmedQueue).to(eventsExchange).with(routingKey);
  }

  @Bean
  public Binding orderConfirmedDeadLetterBinding(
      Queue orderConfirmedDeadLetterQueue,
      DirectExchange deadLetterExchange,
      @Value("${events.order-confirmed.queue}") String queue) {
    return BindingBuilder.bind(orderConfirmedDeadLetterQueue).to(deadLetterExchange).with(queue);
  }

  /**
   * 수신 재시도: 일시적인 오류만 최대 3회(첫 시도 포함, 1초·2초 간격) 시도하고, 계속 실패하거나 재시도해도 소용없는 오류는 거절(재큐잉 안 함)해 DLQ로 보낸다.
   */
  @Bean
  public ContainerCustomizer<SimpleMessageListenerContainer> listenerRetryCustomizer() {
    return container ->
        container.setAdviceChain(
            RetryInterceptorBuilder.stateless()
                .maxRetries(2)
                .backOffOptions(1000, 2.0, 10000)
                .configureRetryPolicy(policy -> policy.predicate(ListenerRetryPolicy::isRetryable))
                .recoverer(new RejectAndDontRequeueRecoverer())
                .build());
  }
}
