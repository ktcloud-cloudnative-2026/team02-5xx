package com.peakorder.menu.exception;

import com.peakorder.menu.controller.MenuStatusController;
import com.peakorder.menu.dto.ApiResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice(assignableTypes = MenuStatusController.class)
public class MenuStatusExceptionHandler {
  private static final Logger log = LoggerFactory.getLogger(MenuStatusExceptionHandler.class);

  @ExceptionHandler(MenuStatusChangeException.class)
  public ResponseEntity<ApiResponse<Void>> expected(MenuStatusChangeException e) {
    return ResponseEntity.status(e.status()).body(ApiResponse.fail(e.code(), e.getMessage()));
  }

  @ExceptionHandler(Exception.class)
  public ResponseEntity<ApiResponse<Void>> unexpected(Exception e) {
    log.error("Menu status change failed ({})", e.getClass().getSimpleName());
    return ResponseEntity.internalServerError()
        .body(ApiResponse.fail("INTERNAL_ERROR", "Internal server error"));
  }
}
