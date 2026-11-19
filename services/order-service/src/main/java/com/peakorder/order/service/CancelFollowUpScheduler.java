package com.peakorder.order.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 취소 관련 남은 일을 주기적으로 이어서 처리한다: ① Cooking 응답을 모른 채 남은 취소 요청 재확인(CI-03) ② 취소 후속 처리(재고 복원·환불). 한 번 실패해도
 * 다음 주기에 다시 시도한다.
 */
@Component
public class CancelFollowUpScheduler {

  private static final Logger log = LoggerFactory.getLogger(CancelFollowUpScheduler.class);

  private final OrderCancelService cancelService;
  private final int graceSec;
  private final int batchSize;

  public CancelFollowUpScheduler(
      OrderCancelService cancelService,
      @Value("${cancel.follow-up.grace-sec:10}") int graceSec,
      @Value("${cancel.follow-up.batch-size:20}") int batchSize) {
    this.cancelService = cancelService;
    this.graceSec = graceSec;
    this.batchSize = batchSize;
  }

  @Scheduled(fixedDelayString = "${cancel.follow-up.interval-ms:30000}")
  public void run() {
    try {
      int resolved = cancelService.retryUnresolvedCancelRequests(graceSec, batchSize);
      if (resolved > 0) {
        log.info("결과를 모르던 취소 요청을 확정했습니다 count={}", resolved);
      }
      int completed = cancelService.retryPendingFollowUps(graceSec, batchSize);
      if (completed > 0) {
        log.info("취소 후속 처리를 이어서 끝냈습니다 count={}", completed);
      }
    } catch (RuntimeException e) {
      log.warn("취소 후속 처리 주기 실패, 다음 주기에 다시 시도합니다", e);
    }
  }
}
