package com.peakorder.menu.exception;

public class InvalidMenuIdException extends RuntimeException {
  public InvalidMenuIdException() {
    super("menuId must be a positive Long integer");
  }
}
