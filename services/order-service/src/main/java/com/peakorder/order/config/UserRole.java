package com.peakorder.order.config;

/** Gateway가 검증된 JWT의 {@code role}을 그대로 전달하는 {@code X-User-Role} 값(#112). 이 두 값 외에는 형식 오류로 본다. */
public enum UserRole {
  CUSTOMER,
  STORE_ADMIN
}
