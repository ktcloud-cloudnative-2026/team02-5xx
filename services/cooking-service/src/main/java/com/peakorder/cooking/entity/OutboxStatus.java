package com.peakorder.cooking.entity;

/** 아웃박스 이벤트 발행 상태. DB CHECK 제약(ck_outbox_events_status)과 값이 같아야 한다. */
public enum OutboxStatus {
  PENDING,
  SENT
}
