package com.peakorder.order.service;

import java.time.Duration;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * 취소 후속 처리(재고 복원·환불) 재시도 정책. 실패할수록 간격을 두 배로 늘리고(기본 30초 → 최대 1시간), 실패가 {@code maxAttempts}번에 닿으면 수동
 * 확인 필요로 표시한다. 기본값 12회는 간격 합이 약 5시간 반이라 외부 서비스의 몇 시간짜리 장애는 견디고, 그보다 오래 풀리지 않으면 사람이 보게 한다.
 */
@Component
public class CancelFollowUpPolicy {

  private final int maxAttempts;
  private final Duration baseDelay;
  private final Duration maxDelay;

  @Autowired
  public CancelFollowUpPolicy(
      @Value("${cancel.follow-up.max-attempts:12}") int maxAttempts,
      @Value("${cancel.follow-up.retry-base-sec:30}") long baseSec,
      @Value("${cancel.follow-up.retry-max-sec:3600}") long maxSec) {
    this(maxAttempts, Duration.ofSeconds(baseSec), Duration.ofSeconds(maxSec));
  }

  public CancelFollowUpPolicy(int maxAttempts, Duration baseDelay, Duration maxDelay) {
    if (maxAttempts < 1) {
      throw new IllegalArgumentException("재시도 상한은 1 이상이어야 합니다.");
    }
    this.maxAttempts = maxAttempts;
    this.baseDelay = baseDelay;
    this.maxDelay = maxDelay;
  }

  public int maxAttempts() {
    return maxAttempts;
  }

  /** 이미 {@code failuresSoFar}번 실패했을 때, 그 다음 시도까지 기다릴 시간(0번이면 기본 간격, 매번 두 배, 최대 간격까지). */
  public Duration delayAfter(int failuresSoFar) {
    Duration delay = baseDelay;
    for (int i = 0; i < failuresSoFar && delay.compareTo(maxDelay) < 0; i++) {
      delay = delay.multipliedBy(2);
    }
    return delay.compareTo(maxDelay) > 0 ? maxDelay : delay;
  }
}
