package com.peakorder.menu.exception;

public class MenuCreateException extends RuntimeException {
  private final int status;
  private final String code;

  private MenuCreateException(int status, String code, String message) {
    super(message);
    this.status = status;
    this.code = code;
  }

  public static MenuCreateException invalid() {
    return new MenuCreateException(400, "INVALID_REQUEST", "Invalid menu creation request");
  }

  public static MenuCreateException categoryMissing() {
    return new MenuCreateException(404, "CATEGORY_NOT_FOUND", "Category not found");
  }

  public static MenuCreateException forbidden() {
    return new MenuCreateException(403, "FORBIDDEN", "Administrator access denied");
  }

  public int status() {
    return status;
  }

  public String code() {
    return code;
  }
}
