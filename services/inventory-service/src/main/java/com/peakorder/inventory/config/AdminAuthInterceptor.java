package com.peakorder.inventory.config;

import com.peakorder.inventory.exception.BusinessException;
import com.peakorder.inventory.exception.ErrorCode;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.Collections;
import java.util.List;
import java.util.regex.Pattern;
import org.springframework.web.servlet.HandlerInterceptor;

/**
 * 관리자 API 권한 검사. 신원 헤더(X-User-Id, X-User-Role)는 Gateway가 JWT 검증 후 넣고 클라이언트가 보낸 같은 이름의 헤더는
 * 지운다(#112). 이 검사는 Gateway 우회에 대비한 방어와 역할 확인이다. 값을 변환·추측하지 않으며, 헤더 값은 로그에 남기지 않는다.
 */
public class AdminAuthInterceptor implements HandlerInterceptor {

  static final String USER_ID = "X-User-Id";
  static final String USER_ROLE = "X-User-Role";

  private static final Pattern POSITIVE_ID = Pattern.compile("[1-9][0-9]*");
  private static final String CUSTOMER = "CUSTOMER";
  private static final String STORE_ADMIN = "STORE_ADMIN";

  @Override
  public boolean preHandle(
      HttpServletRequest request, HttpServletResponse response, Object handler) {
    // 1. 회원 ID: 정확히 1개, 공백 없는 양의 정수(long 범위). 아니면 401
    String userId = singleHeader(request, USER_ID);
    if (userId == null || !isPositiveLong(userId)) {
      throw new BusinessException(ErrorCode.UNAUTHORIZED);
    }

    // 2. 역할: 정확히 1개, CUSTOMER 또는 STORE_ADMIN과 정확히 일치. 아니면 401
    String role = singleHeader(request, USER_ROLE);
    if (!CUSTOMER.equals(role) && !STORE_ADMIN.equals(role)) {
      throw new BusinessException(ErrorCode.UNAUTHORIZED);
    }

    // 3. 매장 관리자가 아니면 403
    if (!STORE_ADMIN.equals(role)) {
      throw new BusinessException(ErrorCode.FORBIDDEN);
    }
    return true;
  }

  // 같은 이름의 헤더가 없거나 여러 개면 형식 오류로 본다
  private static String singleHeader(HttpServletRequest request, String name) {
    List<String> values = Collections.list(request.getHeaders(name));
    return values.size() == 1 ? values.get(0) : null;
  }

  private static boolean isPositiveLong(String value) {
    if (!POSITIVE_ID.matcher(value).matches()) {
      return false;
    }
    try {
      Long.parseLong(value);
      return true;
    } catch (NumberFormatException e) {
      return false;
    }
  }
}
