package com.peakorder.cooking.service;

import com.peakorder.cooking.entity.CookingTicket;
import java.time.Duration;
import java.time.Instant;
import java.util.List;

/**
 * 예상 시간 계산 공통 기준 (CI-02, CO-01, CO-03). 회의(11/5·11/11) 결정대로 조리대 1개에서 FIFO로 한 건씩 자동 조리한다고 본다.
 *
 * <ul>
 *   <li>COOKING 전표 남은 시간 = max(0, 예상 조리 시간 − 조리 시작 후 경과 시간)
 *   <li>신규 주문의 예상 대기 = 조리 중 남은 시간 + 대기 중 전표들의 예상 조리 시간 합 (조리 시작까지)
 * </ul>
 */
final class CookingTimes {

  private CookingTimes() {}

  /** 조리 중인 전표의 남은 조리 시간(초) */
  static long remainingSec(CookingTicket cooking, Instant now) {
    long elapsed = Duration.between(cooking.getStartedAt(), now).toSeconds();
    return Math.max(0, cooking.getEstimatedCookSec() - elapsed);
  }

  /** 조리 중인 전표들의 남은 시간 합(초) */
  static long remainingSec(List<CookingTicket> cookingTickets, Instant now) {
    return cookingTickets.stream().mapToLong(t -> remainingSec(t, now)).sum();
  }
}
