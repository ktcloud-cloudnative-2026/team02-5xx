package com.peakorder.order.client;

/** Cooking Service 상태 확인. Cooking의 GET /actuator/health(인증 없음)를 사용한다(Cooking과 합의). */
public interface CookingHealthClient {

  /** 정상 응답(2xx)이면 true. HTTP 503(DOWN)·그 외 오류 응답·연결 실패·타임아웃은 모두 false. */
  boolean isUp();
}
