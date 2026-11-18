package com.peakorder.cooking.exception;

import org.springframework.http.HttpStatus;

public enum ErrorCode {
  INVALID_REQUEST(HttpStatus.BAD_REQUEST, "잘못된 요청입니다."),
  /** 조리 전표 없음. EV-01(OrderConfirmed)이 아직 처리되지 않아 대기열 등록 전인 경우도 포함한다. */
  COOKING_TICKET_NOT_FOUND(HttpStatus.NOT_FOUND, "조리 대기열에 등록되지 않은 주문입니다."),
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
