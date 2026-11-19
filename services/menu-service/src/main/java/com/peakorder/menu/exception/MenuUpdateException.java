package com.peakorder.menu.exception;

public class MenuUpdateException extends RuntimeException {
  private final int status;
  private final String code;

  private MenuUpdateException(int status, String code, String message) {
    super(message);
    this.status = status;
    this.code = code;
  }

  public static MenuUpdateException invalid() {
    return new MenuUpdateException(400, "INVALID_REQUEST", "Invalid menu update request");
  }

  public static MenuUpdateException missingMenu() {
    return new MenuUpdateException(404, "MENU_NOT_FOUND", "Menu not found");
  }

  public static MenuUpdateException missingCategory() {
    return new MenuUpdateException(404, "CATEGORY_NOT_FOUND", "Category not found");
  }

  public static MenuUpdateException missingOption() {
    return new MenuUpdateException(404, "OPTION_NOT_FOUND", "Option not found for menu");
  }

  public static MenuUpdateException forbidden() {
    return new MenuUpdateException(403, "FORBIDDEN", "Administrator access denied");
  }

  public int status() {
    return status;
  }

  public String code() {
    return code;
  }
}
