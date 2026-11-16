package com.peakorder.cooking.config;

import java.time.Clock;
import java.time.ZoneId;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** 시간 기준. 응답 시각은 KST(Asia/Seoul)로 표시한다 (Order 서비스와 동일). */
@Configuration
public class ClockConfig {

  public static final ZoneId ZONE = ZoneId.of("Asia/Seoul");

  @Bean
  public Clock clock() {
    return Clock.system(ZONE);
  }
}
