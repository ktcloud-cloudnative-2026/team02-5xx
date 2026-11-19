package com.peakorder.order.client;

import java.time.OffsetDateTime;
import java.util.Optional;

/**
 * Cooking Service 내부 API 호출(주문 취소). 취소 가능 여부는 Cooking이 최종 판단한다(아키텍처 4.2).
 *
 * <ul>
 *   <li>CI-02 GET /internal/v1/cooking/orders/{orderId} (조리 상태·예상 시간 조회)
 *   <li>CI-03 POST /internal/v1/cooking/orders/{orderId}/cancel (본문 없음, 멱등)
 * </ul>
 */
public interface CookingClient {

  /**
   * 조리 대기열에서 주문을 뺀다. 결과를 알 수 없으면(타임아웃, 5xx, 연결 실패) 예외를 던지며 호출자는 주문을 그대로 둬야 한다.
   *
   * @throws com.peakorder.order.exception.BusinessException 결과를 알 수 없으면
   *     COOKING_SERVICE_UNAVAILABLE, 응답이 계약과 다르면 UPSTREAM_INVALID_RESPONSE
   */
  CancelResult cancel(Long orderId);

  /**
   * 조리 상태 조회(CI-02). 값은 아래 의미로 정규화해서 돌려준다.
   *
   * @return 전표가 아직 없으면(404 COOKING_TICKET_NOT_FOUND) 비어 있다
   * @throws com.peakorder.order.exception.BusinessException 장애·시간 초과(5xx, 연결 실패)면
   *     COOKING_SERVICE_UNAVAILABLE, 계약과 다른 응답이면 UPSTREAM_INVALID_RESPONSE
   */
  Optional<CookingStatus> getStatus(Long orderId);

  /**
   * @param status WAITING, COOKING, DONE, CANCELED
   * @param expectedWaitSec 지금부터 조리 시작까지(초). 대기 중이 아니면 0
   * @param expectedReadySec 지금부터 조리 완료까지(초). 완료·취소는 0
   */
  record CookingStatus(
      String status,
      long waitingAhead,
      int estimatedCookSec,
      long expectedWaitSec,
      long expectedReadySec,
      OffsetDateTime startedAt) {}

  enum CancelResult {
    /** 200: 취소됨(이미 취소된 주문의 재요청 포함). */
    CANCELED,
    /** 409 COOKING_ALREADY_STARTED: 조리가 시작되어 취소할 수 없다. */
    ALREADY_STARTED,
    /** 409 COOKING_ALREADY_DONE: 조리가 끝나 취소할 수 없다. */
    ALREADY_DONE,
    /** 404 COOKING_TICKET_NOT_FOUND: 아직 접수 처리 전일 수 있다. 취소로 보지 않는다. */
    TICKET_NOT_FOUND
  }
}
