package com.peakorder.cooking.exception;

import org.springframework.http.HttpStatus;

public enum ErrorCode {
  INVALID_REQUEST(HttpStatus.BAD_REQUEST, "잘못된 요청입니다."),
  /** 조리 전표 없음. EV-01(OrderConfirmed)이 아직 처리되지 않아 대기열 등록 전인 경우도 포함한다. */
  COOKING_TICKET_NOT_FOUND(HttpStatus.NOT_FOUND, "조리 대기열에 등록되지 않은 주문입니다."),
  /** CI-03: 조리가 이미 시작되어(COOKING) 취소할 수 없음 */
  COOKING_ALREADY_STARTED(HttpStatus.CONFLICT, "조리가 이미 시작되어 취소할 수 없습니다."),
  /** CI-03: 조리가 이미 끝나(DONE) 취소할 수 없음 */
  COOKING_ALREADY_DONE(HttpStatus.CONFLICT, "조리가 이미 완료되어 취소할 수 없습니다."),
  /** CO-02: Menu MI-01이 4xx로 거절(판매 불가·잘못된 옵션). Order와 같은 코드·상태 */
  MENU_NOT_AVAILABLE(HttpStatus.CONFLICT, "주문할 수 없는 메뉴 또는 옵션이 포함되어 있습니다."),
  /** CO-02: Menu 장애·타임아웃 */
  MENU_SERVICE_UNAVAILABLE(HttpStatus.SERVICE_UNAVAILABLE, "메뉴 정보를 확인할 수 없습니다. 잠시 후 다시 시도해 주세요."),
  /** CO-02: Menu 응답 형식이 계약과 다름 */
  UPSTREAM_INVALID_RESPONSE(HttpStatus.BAD_GATEWAY, "연동 서비스의 응답이 올바르지 않습니다."),
  INTERNAL_ERROR(HttpStatus.INTERNAL_SERVER_ERROR, "서버 내부 오류가 발생했습니다.");

  private final HttpStatus status;
  private final String message;

  ErrorCode(HttpStatus status, String message) {
    this.status = status;
    this.message = message;
  }

  public HttpStatus status() {
    return status;
  }

  public String message() {
    return message;
  }
}
