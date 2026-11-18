package com.peakorder.menu.exception;

import com.peakorder.menu.controller.MenuInternalController;
import com.peakorder.menu.dto.ApiResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice(assignableTypes = MenuInternalController.class)
public class MenuExceptionHandler {
  private static final Logger log = LoggerFactory.getLogger(MenuExceptionHandler.class);

  @ExceptionHandler(PurchaseValidationException.class)
  public ResponseEntity<ApiResponse<Void>> invalidRequest(PurchaseValidationException exception) {
    return ResponseEntity.badRequest()
        .body(ApiResponse.fail("INVALID_REQUEST", exception.getMessage()));
  }

  @ExceptionHandler(HttpMessageNotReadableException.class)
  public ResponseEntity<ApiResponse<Void>> unreadableRequest() {
    return ResponseEntity.badRequest()
        .body(ApiResponse.fail("INVALID_REQUEST", "Invalid JSON request"));
  }

  @ExceptionHandler(Exception.class)
  public ResponseEntity<ApiResponse<Void>> internalError(Exception exception) {
    // Do not expose SQL, connection details or credentials in responses or logs.
    log.error("MI-01 purchase validation failed ({})", exception.getClass().getSimpleName());
    return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
        .body(ApiResponse.fail("INTERNAL_ERROR", "Internal server error"));
  }
}
