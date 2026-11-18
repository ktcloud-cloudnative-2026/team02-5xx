package com.peakorder.menu.exception;

import com.peakorder.menu.controller.CustomerMenuController;
import com.peakorder.menu.dto.ApiResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice(assignableTypes = CustomerMenuController.class)
public class CustomerMenuExceptionHandler {
  private static final Logger log = LoggerFactory.getLogger(CustomerMenuExceptionHandler.class);

  @ExceptionHandler(CustomerMenuQueryException.class)
  public ResponseEntity<ApiResponse<Void>> invalidRequest(CustomerMenuQueryException exception) {
    return ResponseEntity.badRequest()
        .body(ApiResponse.fail("INVALID_REQUEST", exception.getMessage()));
  }

  @ExceptionHandler(CustomerMenuNotFoundException.class)
  public ResponseEntity<ApiResponse<Void>> notFound() {
    return ResponseEntity.status(HttpStatus.NOT_FOUND)
        .body(ApiResponse.fail("MENU_NOT_FOUND", "Menu not found"));
  }

  @ExceptionHandler(Exception.class)
  public ResponseEntity<ApiResponse<Void>> internalError(Exception exception) {
    // Never expose database details, SQL or credentials in public responses.
    log.error("Customer menu query failed ({})", exception.getClass().getSimpleName());
    return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
        .body(ApiResponse.fail("INTERNAL_ERROR", "Internal server error"));
  }
}
