package com.peakorder.inventory.exception;

import org.springframework.http.HttpStatus;

public enum ErrorCode {
  INVALID_REQUEST(HttpStatus.BAD_REQUEST, "잘못된 요청입니다."),
  INVENTORY_NOT_FOUND(HttpStatus.NOT_FOUND, "재고 항목을 찾을 수 없습니다."),
  INSUFFICIENT_STOCK(HttpStatus.CONFLICT, "재고가 부족합니다."),
  STOCK_NOT_LINKED(HttpStatus.CONFLICT, "재고가 연결되지 않은 메뉴입니다."),
  HOLD_NOT_ACTIVE(HttpStatus.CONFLICT, "유효하지 않은 재고 확보입니다."),
  HOLD_NOT_FOUND(HttpStatus.NOT_FOUND, "재고 확보를 찾을 수 없습니다."),
  RESTORE_NOT_APPLICABLE(HttpStatus.CONFLICT, "복원할 수 없는 주문입니다."),
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
