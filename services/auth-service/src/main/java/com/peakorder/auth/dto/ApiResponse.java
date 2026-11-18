package com.peakorder.auth.dto;

import com.fasterxml.jackson.annotation.JsonInclude;

public record ApiResponse<T>(
    boolean success,
    T data,
    String message,
    @JsonInclude(JsonInclude.Include.NON_NULL) String errorCode) {

  public static <T> ApiResponse<T> ok(T data, String message) {
    return new ApiResponse<>(true, data, message, null);
  }

  public static ApiResponse<Void> fail(String errorCode, String message) {
    return new ApiResponse<>(false, null, message, errorCode);
  }
}
