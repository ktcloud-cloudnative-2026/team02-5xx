package com.peakorder.order.exception;

import org.springframework.http.HttpStatus;

public enum ErrorCode {
  INVALID_REQUEST(HttpStatus.BAD_REQUEST, "잘못된 요청입니다."),
  ORDER_NOT_FOUND(HttpStatus.NOT_FOUND, "주문을 찾을 수 없습니다."),
  STORE_NOT_ACCEPTING_ORDERS(HttpStatus.CONFLICT, "현재 주문을 받을 수 없습니다."),
  MENU_NOT_AVAILABLE(HttpStatus.CONFLICT, "주문할 수 없는 메뉴 또는 옵션이 포함되어 있습니다."),
  OUT_OF_STOCK(HttpStatus.CONFLICT, "재고가 부족하여 주문할 수 없습니다."),
  ORDER_NOT_PAYABLE(HttpStatus.CONFLICT, "결제할 수 없는 주문입니다. 새로 주문해 주세요."),
  ORDER_PAY_IN_PROGRESS(HttpStatus.CONFLICT, "이 주문의 결제가 처리 중입니다. 잠시 후 주문 상태를 확인해 주세요."),
  ORDER_NOT_CANCELABLE(HttpStatus.CONFLICT, "취소할 수 없는 주문입니다."),
  ORDER_PAYMENT_PENDING(
      HttpStatus.CONFLICT, "결제 결과를 확인하는 중이라 지금은 취소할 수 없습니다. 결제를 다시 시도해 결과를 확인해 주세요."),
  COOKING_ALREADY_STARTED(HttpStatus.CONFLICT, "조리가 이미 시작되어 취소할 수 없습니다."),
  COOKING_ALREADY_DONE(HttpStatus.CONFLICT, "조리가 이미 끝나 취소할 수 없습니다."),
  COOKING_ORDER_PENDING(HttpStatus.CONFLICT, "주문이 접수 처리 중입니다. 잠시 후 다시 시도해 주세요."),
  COOKING_SERVICE_UNAVAILABLE(
      HttpStatus.SERVICE_UNAVAILABLE,
      "취소 요청의 결과를 확인하지 못했습니다. 요청은 접수되어 확인되는 대로 자동 처리됩니다. 잠시 후 주문 상태를 확인해 주세요."),
  HOLD_EXPIRED(HttpStatus.CONFLICT, "재고 확보 시간이 지나 주문이 종료되었습니다. 새로 주문해 주세요."),
  PAYMENT_FAILED(HttpStatus.PAYMENT_REQUIRED, "결제에 실패했습니다. 새로 주문해 주세요."),
  STOCK_CONFIRM_FAILED(HttpStatus.CONFLICT, "재고를 확정하지 못해 주문이 종료되었습니다. 새로 주문해 주세요."),
  MENU_SERVICE_UNAVAILABLE(HttpStatus.SERVICE_UNAVAILABLE, "메뉴 정보를 확인할 수 없습니다. 잠시 후 다시 시도해 주세요."),
  INVENTORY_SERVICE_UNAVAILABLE(HttpStatus.SERVICE_UNAVAILABLE, "재고를 확인할 수 없습니다. 잠시 후 다시 시도해 주세요."),
  COOKING_UNAVAILABLE(
      HttpStatus.SERVICE_UNAVAILABLE, "조리 서비스에 문제가 있어 지금은 주문과 결제를 할 수 없습니다. 잠시 후 다시 시도해 주세요."),
  PAYMENT_SERVICE_UNAVAILABLE(
      HttpStatus.SERVICE_UNAVAILABLE, "결제 결과를 확인할 수 없습니다. 같은 주문으로 잠시 후 다시 시도해 주세요."),
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
