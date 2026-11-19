package com.peakorder.payment.exception;

import org.springframework.http.HttpStatus;

public enum ErrorCode {
  INVALID_REQUEST(HttpStatus.BAD_REQUEST, "잘못된 요청입니다."),
  PAYMENT_NOT_FOUND(HttpStatus.NOT_FOUND, "결제 정보를 찾을 수 없습니다."),
  PAYMENT_ALREADY_EXISTS(HttpStatus.CONFLICT, "이미 결제 기록이 있는 주문입니다. 재시도는 새 주문으로 해 주세요."),
  IDEMPOTENCY_KEY_CONFLICT(HttpStatus.CONFLICT, "같은 idempotencyKey로 다른 결제 요청이 들어왔습니다."),
  PAYMENT_NOT_REFUNDABLE(HttpStatus.CONFLICT, "환불할 수 없는 결제입니다(승인된 결제만 환불 가능)."),
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
