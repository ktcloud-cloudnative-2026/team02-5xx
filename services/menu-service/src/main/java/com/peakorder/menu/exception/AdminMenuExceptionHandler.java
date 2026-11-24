package com.peakorder.menu.exception;

import com.peakorder.menu.controller.AdminMenuController;
import com.peakorder.menu.controller.AdminMenuCreateController;
import com.peakorder.menu.controller.MenuStatusController;
import com.peakorder.menu.controller.MenuUpdateController;
import com.peakorder.menu.dto.ApiResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice(
    assignableTypes = {
      AdminMenuController.class, AdminMenuCreateController.class,
      MenuUpdateController.class, MenuStatusController.class
    })
public class AdminMenuExceptionHandler {
  private static final Logger log = LoggerFactory.getLogger(AdminMenuExceptionHandler.class);

  @ExceptionHandler(AdminMenuAccessException.class)
  public ResponseEntity<ApiResponse<Void>> denied(AdminMenuAccessException exception) {
    return ResponseEntity.status(exception.status())
        .body(ApiResponse.fail(exception.errorCode(), exception.getMessage()));
  }

  @ExceptionHandler(AdminMenuQueryException.class)
  public ResponseEntity<ApiResponse<Void>> invalidQuery(AdminMenuQueryException exception) {
    return ResponseEntity.status(exception.errorCode().equals("MENU_NOT_FOUND") ? 404 : 400)
        .body(ApiResponse.fail(exception.errorCode(), exception.getMessage()));
  }

  @ExceptionHandler(MenuCreateException.class)
  public ResponseEntity<ApiResponse<Void>> create(MenuCreateException exception) {
    return ResponseEntity.status(exception.status())
        .body(ApiResponse.fail(exception.code(), exception.getMessage()));
  }

  @ExceptionHandler(MenuUpdateException.class)
  public ResponseEntity<ApiResponse<Void>> update(MenuUpdateException exception) {
    return ResponseEntity.status(exception.status())
        .body(ApiResponse.fail(exception.code(), exception.getMessage()));
  }

  @ExceptionHandler(MenuStatusChangeException.class)
  public ResponseEntity<ApiResponse<Void>> status(MenuStatusChangeException exception) {
    return ResponseEntity.status(exception.status())
        .body(ApiResponse.fail(exception.code(), exception.getMessage()));
  }

  @ExceptionHandler(Exception.class)
  public ResponseEntity<ApiResponse<Void>> unexpected(Exception exception) {
    log.error("Administrator menu request failed ({})", exception.getClass().getSimpleName());
    return ResponseEntity.internalServerError()
        .body(ApiResponse.fail("INTERNAL_ERROR", "Internal server error"));
  }
}
