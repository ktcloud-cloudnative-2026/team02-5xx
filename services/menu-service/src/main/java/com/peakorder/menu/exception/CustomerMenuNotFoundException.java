package com.peakorder.menu.exception;

public class CustomerMenuNotFoundException extends RuntimeException {
  public CustomerMenuNotFoundException() {
    super("Menu not found");
  }
}
