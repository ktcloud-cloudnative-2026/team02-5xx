package com.peakorder.auth.controller;

import com.peakorder.auth.exception.BusinessException;
import com.peakorder.auth.exception.ErrorCode;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Collections;
import org.springframework.http.HttpHeaders;

final class BearerAuthorization {
  private BearerAuthorization() {}

  static String token(HttpServletRequest request) {
    var authorization = Collections.list(request.getHeaders(HttpHeaders.AUTHORIZATION));
    if (authorization.size() != 1
        || !authorization.getFirst().regionMatches(true, 0, "Bearer ", 0, 7))
      throw new BusinessException(ErrorCode.UNAUTHORIZED);
    String token = authorization.getFirst().substring(7);
    if (token.isBlank() || token.contains(" ") || token.contains(","))
      throw new BusinessException(ErrorCode.UNAUTHORIZED);
    return token;
  }
}
