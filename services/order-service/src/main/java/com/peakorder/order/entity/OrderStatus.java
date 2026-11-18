package com.peakorder.order.entity;

public enum OrderStatus {
  CREATED,
  PAID,
  WAITING,
  COOKING,
  COMPLETED,
  CANCELED,
  FAILED;

  /** 결제·재고 확정이 끝난 상태(PAID 이후 진행 중이거나 완료). */
  public boolean isConfirmed() {
    return this == PAID || this == WAITING || this == COOKING || this == COMPLETED;
  }
}
