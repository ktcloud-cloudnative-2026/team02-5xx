package com.peakorder.menu.exception;

import com.peakorder.menu.controller.AdminMenuCreateController;
import com.peakorder.menu.dto.ApiResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice(assignableTypes = AdminMenuCreateController.class)
public class MenuCreateExceptionHandler {
  private static final Logger log = LoggerFactory.getLogger(MenuCreateExceptionHandler.class);

  @ExceptionHandler(MenuCreateException.class)
  public ResponseEntity<ApiResponse<Void>> expected(MenuCreateException exception) {
    return ResponseEntity.status(exception.status())
        .body(ApiResponse.fail(exception.code(), exception.getMessage()));
  }

  @ExceptionHandler(Exception.class)
  public ResponseEntity<ApiResponse<Void>> unexpected(Exception exception) {
    log.error("Menu creation failed ({})", exception.getClass().getSimpleName());
    return ResponseEntity.internalServerError()
        .body(ApiResponse.fail("INTERNAL_ERROR", "Internal server error"));
  }
}
