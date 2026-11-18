package com.peakorder.menu.exception;

import com.peakorder.menu.controller.CustomerMenuController;
import com.peakorder.menu.dto.ApiResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

@RestControllerAdvice(assignableTypes = CustomerMenuController.class)
public class CustomerMenuExceptionHandler {
  private static final Logger log = LoggerFactory.getLogger(CustomerMenuExceptionHandler.class);

  @ExceptionHandler(CustomerMenuException.class)
  public ResponseEntity<ApiResponse<Void>> queryError(CustomerMenuException exception) {
    return ResponseEntity.status(exception.isNotFound() ? 404 : 400)
        .body(
            ApiResponse.fail(
                exception.isNotFound() ? "MENU_NOT_FOUND" : "INVALID_REQUEST",
                exception.getMessage()));
  }

  @ExceptionHandler(MethodArgumentTypeMismatchException.class)
  public ResponseEntity<ApiResponse<Void>> invalidParameters() {
    return queryError(CustomerMenuException.invalidRequest());
  }

  @ExceptionHandler(Exception.class)
  public ResponseEntity<ApiResponse<Void>> unexpected(Exception exception) {
    log.error("Customer menu query failed ({})", exception.getClass().getSimpleName());
    return ResponseEntity.internalServerError()
        .body(ApiResponse.fail("INTERNAL_ERROR", "Internal server error"));
  }
}
