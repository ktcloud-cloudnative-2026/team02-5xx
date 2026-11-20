package com.peakorder.auth.config;

import com.peakorder.auth.service.AccessTokenService;
import java.time.Clock;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
@ConditionalOnProperty(name = "auth.session.enabled", havingValue = "true")
@EnableConfigurationProperties(SessionProperties.class)
public class SessionConfiguration {
  @Bean
  Clock sessionClock() {
    return Clock.systemUTC();
  }

  @Bean
  AccessTokenService accessTokenService(SessionProperties properties, Clock clock) {
    return AccessTokenService.fromFiles(properties, clock);
  }

  @Bean
  SessionCookiePolicy sessionCookiePolicy(SessionProperties properties, Clock clock) {
    return new SessionCookiePolicy(properties, clock);
  }
}
