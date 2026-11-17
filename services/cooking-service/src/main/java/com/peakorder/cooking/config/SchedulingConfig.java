package com.peakorder.cooking.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;

/**
 * 자동 조리 진행·outbox 발행 스케줄러 활성화.
 *
 * <p>스케줄러 스레드를 작업 수만큼(2개) 둔다. 기본값(1개)이면 outbox 발행이 RabbitMQ 확인을 기다리는 동안(최대 5초) 자동 조리 진행도 함께 멈추기
 * 때문이다(PR #78 리뷰). @Scheduled 작업을 추가하면 풀 크기도 함께 늘린다.
 */
@Configuration
@EnableScheduling
public class SchedulingConfig {

  /** 동시에 돌아야 하는 @Scheduled 작업 수: CookingProgressScheduler, OutboxRelayScheduler */
  static final int POOL_SIZE = 2;

  @Bean
  public ThreadPoolTaskScheduler taskScheduler() {
    ThreadPoolTaskScheduler scheduler = new ThreadPoolTaskScheduler();
    scheduler.setPoolSize(POOL_SIZE);
    scheduler.setThreadNamePrefix("cooking-scheduler-");
    return scheduler;
  }
}
