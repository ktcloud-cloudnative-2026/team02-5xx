package com.peakorder.order.dto;

import com.fasterxml.jackson.annotation.JsonInclude;

/** 공통 응답 형식. 성공: success, data, message / 실패: errorCode 추가. */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record ApiResponse<T>(boolean success, T data, String message, String errorCode) {

  public static <T> ApiResponse<T> ok(T data) {
    return new ApiResponse<>(true, data, "OK", null);
  }

  public static <T> ApiResponse<T> ok(T data, String message) {
    return new ApiResponse<>(true, data, message, null);
  }

  public static ApiResponse<Void> fail(String errorCode, String message) {
    return new ApiResponse<>(false, null, message, errorCode);
  }
}
