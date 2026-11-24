package com.peakorder.menu.exception;

public class MenuStatusChangeException extends RuntimeException {
  private final int status;
  private final String code;

  private MenuStatusChangeException(int status, String code, String message) {
    super(message);
    this.status = status;
    this.code = code;
  }

  public static MenuStatusChangeException invalid() {
    return new MenuStatusChangeException(400, "INVALID_REQUEST", "Invalid menu status request");
  }

  public static MenuStatusChangeException missing() {
    return new MenuStatusChangeException(404, "MENU_NOT_FOUND", "Menu not found");
  }


  public int status() {
    return status;
  }

  public String code() {
    return code;
  }
}
