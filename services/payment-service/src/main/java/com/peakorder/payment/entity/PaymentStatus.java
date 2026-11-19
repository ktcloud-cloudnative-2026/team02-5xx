package com.peakorder.payment.entity;

/** 결제 상태 (ERD 3-5). 모의 결제는 즉시 결과가 나오므로 REQUESTED·CANCELED는 현재 쓰지 않는다. */
public enum PaymentStatus {
  REQUESTED,
  APPROVED,
  FAILED,
  CANCELED,
  REFUNDED
}
