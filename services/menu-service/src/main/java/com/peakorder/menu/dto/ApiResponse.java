package com.peakorder.menu.dto;

import com.fasterxml.jackson.annotation.JsonInclude;

@JsonInclude(JsonInclude.Include.NON_NULL)
public record ApiResponse<T>(boolean success, T data, String message, String errorCode) {
  public static <T> ApiResponse<T> ok(T data) {
    return new ApiResponse<>(true, data, "OK", null);
  }

  public static ApiResponse<Void> fail(String code, String message) {
    return new ApiResponse<>(false, null, message, code);
  }
}
