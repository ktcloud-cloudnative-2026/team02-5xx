package com.peakorder.menu.exception;

/** Query failures for later mapping by an authenticated administrator controller. */
public class AdminMenuQueryException extends RuntimeException {
  private final String errorCode;

  private AdminMenuQueryException(String errorCode, String message) {
    super(message);
    this.errorCode = errorCode;
  }

  public static AdminMenuQueryException invalidRequest() {
    return new AdminMenuQueryException("INVALID_REQUEST", "Invalid administrator menu query");
  }

  public static AdminMenuQueryException notFound() {
    return new AdminMenuQueryException("MENU_NOT_FOUND", "Menu not found");
  }

  public String errorCode() {
    return errorCode;
  }
}
