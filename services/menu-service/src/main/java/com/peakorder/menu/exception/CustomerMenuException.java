package com.peakorder.menu.exception;

public class CustomerMenuException extends RuntimeException {
  private final boolean notFound;

  private CustomerMenuException(boolean notFound, String message) {
    super(message);
    this.notFound = notFound;
  }

  public static CustomerMenuException invalidRequest() {
    return new CustomerMenuException(false, "Invalid menu query parameters");
  }

  public static CustomerMenuException notFound() {
    return new CustomerMenuException(true, "Menu not found");
  }

  public boolean isNotFound() {
    return notFound;
  }
}
