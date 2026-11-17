package com.peakorder.cooking.dto;

/**
 * CO-01 현재 혼잡도.
 *
 * @param level expectedWaitSec가 혼잡 기준(busy_wait_sec) 이상이면 CROWDED
 * @param waitingCount 대기 주문 수
 * @param cookingCount 조리 중 주문 수
 * @param expectedWaitSec 지금 주문하면 조리 시작까지 예상 대기 시간(초)
 */
public record CongestionResponse(
    Level level, long waitingCount, long cookingCount, long expectedWaitSec) {

  /** ERD congestion_snapshots.level과 같은 값 */
  public enum Level {
    NORMAL,
    CROWDED
  }
}
