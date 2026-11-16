package com.peakorder.order.service;

import com.peakorder.order.exception.BusinessException;
import com.peakorder.order.exception.ErrorCode;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Cooking 장애 상태(US-13). 헬스 확인이 연속으로 실패하면 "장애"로 전환해 신규 주문·결제를 막고, 한 번이라도 성공하면 바로 해제한다. 기동 직후에는 정상으로
 * 간주한다(첫 실패 한 번으로 차단하지 않음). 상태는 인스턴스마다 독립적으로 판단한다.
 */
@Component
public class CookingAvailability {

  private static final Logger log = LoggerFactory.getLogger(CookingAvailability.class);

  private final int failureThreshold;
  private final AtomicInteger consecutiveFailures = new AtomicInteger();
  private final AtomicBoolean unavailable = new AtomicBoolean(false);

  public CookingAvailability(
      MeterRegistry meterRegistry,
      @Value("${cooking-health.failure-threshold:3}") int failureThreshold) {
    this.failureThreshold = failureThreshold;
    Gauge.builder("order.cooking.available", this, a -> a.isAvailable() ? 1.0 : 0.0)
        .description("Order가 판단한 Cooking 서비스 가용 여부 (1=정상, 0=장애로 주문·결제 차단 중)")
        .register(meterRegistry);
  }

  public void recordSuccess() {
    consecutiveFailures.set(0);
    if (unavailable.compareAndSet(true, false)) {
      log.info("Cooking 서비스가 복구되어 신규 주문·결제를 다시 허용합니다.");
    }
  }

  public void recordFailure() {
    int failures = consecutiveFailures.incrementAndGet();
    if (failures >= failureThreshold && unavailable.compareAndSet(false, true)) {
      log.warn("Cooking 서비스 헬스 확인이 {}회 연속 실패하여 신규 주문·결제를 차단합니다.", failures);
    }
  }

  public boolean isAvailable() {
    return !unavailable.get();
  }

  /**
   * @throws BusinessException Cooking 장애로 판단된 상태면 COOKING_UNAVAILABLE(503)
   */
  public void ensureAvailable() {
    if (!isAvailable()) {
      throw new BusinessException(ErrorCode.COOKING_UNAVAILABLE);
    }
  }
}
