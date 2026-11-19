package com.peakorder.cooking.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 자동 조리 진행을 주기적으로 실행한다. `cooking.progress.enabled=false`면 등록되지 않는다(테스트 환경). 한 번 실패해도 다음 주기에 다시
 * 시도한다.
 */
@Component
@ConditionalOnProperty(
    name = "cooking.progress.enabled",
    havingValue = "true",
    matchIfMissing = true)
public class CookingProgressScheduler {

  private static final Logger log = LoggerFactory.getLogger(CookingProgressScheduler.class);

  private final CookingProgressService progressService;

  public CookingProgressScheduler(CookingProgressService progressService) {
    this.progressService = progressService;
  }

  @Scheduled(fixedDelayString = "${cooking.progress.interval-ms:1000}")
  public void run() {
    try {
      progressService.tick();
    } catch (RuntimeException e) {
      log.warn("자동 조리 진행 실패, 다음 주기에 다시 시도합니다: {}", e.toString());
    }
  }
}
