package com.peakorder.cooking.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;

/** 자동 조리 진행·outbox 발행 스케줄러 활성화 */
@Configuration
@EnableScheduling
public class SchedulingConfig {}
