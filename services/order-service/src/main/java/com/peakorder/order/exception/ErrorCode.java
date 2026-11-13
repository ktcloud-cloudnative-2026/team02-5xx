package com.peakorder.order.exception;

import org.springframework.http.HttpStatus;

public enum ErrorCode {
  INVALID_REQUEST(HttpStatus.BAD_REQUEST, "잘못된 요청입니다."),
  ORDER_NOT_FOUND(HttpStatus.NOT_FOUND, "주문을 찾을 수 없습니다."),
  STORE_NOT_ACCEPTING_ORDERS(HttpStatus.CONFLICT, "현재 주문을 받을 수 없습니다."),
  MENU_NOT_AVAILABLE(HttpStatus.CONFLICT, "주문할 수 없는 메뉴 또는 옵션이 포함되어 있습니다."),
  OUT_OF_STOCK(HttpStatus.CONFLICT, "재고가 부족하여 주문할 수 없습니다."),
  MENU_SERVICE_UNAVAILABLE(HttpStatus.SERVICE_UNAVAILABLE, "메뉴 정보를 확인할 수 없습니다. 잠시 후 다시 시도해 주세요."),
  INVENTORY_SERVICE_UNAVAILABLE(HttpStatus.SERVICE_UNAVAILABLE, "재고를 확인할 수 없습니다. 잠시 후 다시 시도해 주세요."),
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
