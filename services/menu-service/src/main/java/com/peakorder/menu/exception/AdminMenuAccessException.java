package com.peakorder.menu.exception;

/** #112 service-side 401/403 mappings; ingress verification is a separate boundary. */
public class AdminMenuAccessException extends RuntimeException {
  private final int status;
  private final String errorCode;

  private AdminMenuAccessException(int status, String errorCode, String message) {
    super(message);
    this.status = status;
    this.errorCode = errorCode;
  }

  public static AdminMenuAccessException unauthenticated() {
    return new AdminMenuAccessException(401, "UNAUTHORIZED", "Authentication required");
  }

  public static AdminMenuAccessException forbidden() {
    return new AdminMenuAccessException(403, "FORBIDDEN", "Administrator access denied");
  }

  public int status() {
    return status;
  }

  public String errorCode() {
    return errorCode;
  }
}
