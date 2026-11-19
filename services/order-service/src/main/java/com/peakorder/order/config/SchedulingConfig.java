package com.peakorder.order.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;

/**
 * 스케줄러 스레드 설정. Spring의 기본 스케줄러는 스레드가 1개라서, outbox 발행이 RabbitMQ 확인(publisher confirm, 최대 5초)을 기다리는
 * 동안 Cooking 헬스 점검도 함께 멈춘다. RabbitMQ 장애는 Cooking DOWN으로 판단해야 하는 상황인데 점검이 밀리면 5초 주기·3회 연속 실패 차단이 크게
 * 늦어진다(PR #56 리뷰).
 *
 * <p>동시에 돌아야 하는 {@code @Scheduled} 작업마다 스레드를 하나씩 둔다. 작업을 추가하면 {@link #POOL_SIZE}도 함께 늘린다.
 */
@Configuration
public class SchedulingConfig {

  /**
   * 동시에 돌아야 하는 @Scheduled 작업 수: OutboxRelayScheduler, CookingHealthChecker, CancelFollowUpScheduler
   */
  public static final int POOL_SIZE = 3;

  @Bean
  public ThreadPoolTaskScheduler taskScheduler() {
    ThreadPoolTaskScheduler scheduler = new ThreadPoolTaskScheduler();
    scheduler.setPoolSize(POOL_SIZE);
    scheduler.setThreadNamePrefix("order-scheduler-");
    return scheduler;
  }
}
