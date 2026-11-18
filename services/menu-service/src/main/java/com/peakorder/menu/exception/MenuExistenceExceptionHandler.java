package com.peakorder.menu.exception;

import com.peakorder.menu.controller.MenuExistenceController;
import com.peakorder.menu.dto.ApiResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

@RestControllerAdvice(assignableTypes = MenuExistenceController.class)
public class MenuExistenceExceptionHandler {
  private static final Logger log = LoggerFactory.getLogger(MenuExistenceExceptionHandler.class);

  @ExceptionHandler({InvalidMenuIdException.class, MethodArgumentTypeMismatchException.class})
  public ResponseEntity<ApiResponse<Void>> invalidMenuId() {
    return ResponseEntity.badRequest()
        .body(ApiResponse.fail("INVALID_REQUEST", "menuId must be a positive Long integer"));
  }

  @ExceptionHandler(Exception.class)
  public ResponseEntity<ApiResponse<Void>> internalError(Exception exception) {
    // Exception messages and stack traces may contain database connection details.
    log.error("MI-02 menu existence check failed ({})", exception.getClass().getSimpleName());
    return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
        .body(ApiResponse.fail("INTERNAL_ERROR", "Internal server error"));
  }
}
