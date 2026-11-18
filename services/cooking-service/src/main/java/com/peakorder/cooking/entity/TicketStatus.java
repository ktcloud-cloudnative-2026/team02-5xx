package com.peakorder.cooking.entity;

/** 조리 전표 상태. DB CHECK 제약(ck_cooking_tickets_status)과 값이 같아야 한다. */
public enum TicketStatus {
  WAITING,
  COOKING,
  DONE,
  CANCELED
}
