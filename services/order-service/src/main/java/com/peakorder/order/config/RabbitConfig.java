package com.peakorder.order.config;

import com.peakorder.order.messaging.ListenerRetryPolicy;
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
import org.springframework.scheduling.annotation.EnableScheduling;

/**
 * RabbitMQ 교환기·큐 선언. 이름과 라우팅 키는 초안이며 Cooking 담당자와 합의 후 확정한다.
 *
 * <p>Order는 교환기와 자기가 받는 큐(CookingCompleted)만 선언한다. OrderConfirmed를 받는 큐는 Cooking이 선언하고 같은 교환기에
 * 바인딩한다. 바인딩이 없어 라우팅되지 않은 메시지는 outbox에 PENDING으로 남아 다시 발행된다.
 */
@Configuration
@EnableScheduling
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
  public Queue cookingCompletedQueue(
      @Value("${events.cooking-completed.queue}") String queue,
      @Value("${events.dead-letter-exchange}") String deadLetterExchange) {
    return QueueBuilder.durable(queue)
        .withArguments(
            Map.of(
                "x-dead-letter-exchange", deadLetterExchange,
                "x-dead-letter-routing-key", queue))
        .build();
  }

  @Bean
  public Queue cookingCompletedDeadLetterQueue(
      @Value("${events.cooking-completed.queue}") String queue) {
    return QueueBuilder.durable(queue + ".dlq").build();
  }

  @Bean
  public Binding cookingCompletedBinding(
      Queue cookingCompletedQueue,
      TopicExchange eventsExchange,
      @Value("${events.cooking-completed.routing-key}") String routingKey) {
    return BindingBuilder.bind(cookingCompletedQueue).to(eventsExchange).with(routingKey);
  }

  @Bean
  public Binding cookingCompletedDeadLetterBinding(
      Queue cookingCompletedDeadLetterQueue,
      DirectExchange deadLetterExchange,
      @Value("${events.cooking-completed.queue}") String queue) {
    return BindingBuilder.bind(cookingCompletedDeadLetterQueue).to(deadLetterExchange).with(queue);
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
