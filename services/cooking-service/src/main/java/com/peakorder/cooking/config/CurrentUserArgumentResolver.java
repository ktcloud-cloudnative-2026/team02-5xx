package com.peakorder.cooking.config;

import com.peakorder.cooking.exception.BusinessException;
import com.peakorder.cooking.exception.ErrorCode;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Collections;
import java.util.List;
import java.util.regex.Pattern;
import org.springframework.core.MethodParameter;
import org.springframework.web.bind.support.WebDataBinderFactory;
import org.springframework.web.context.request.NativeWebRequest;
import org.springframework.web.method.support.HandlerMethodArgumentResolver;
import org.springframework.web.method.support.ModelAndViewContainer;

/**
 * {@link CurrentUser} 파라미터를 {@code X-User-Id}·{@code X-User-Role} 헤더로 채운다.
 *
 * <p>Gateway가 JWT를 검증한 뒤 {@code sub}·{@code role}을 그대로 헤더에 넣고, 클라이언트가 보낸 같은 이름의 헤더는 항상 제거한다(#112
 * Gateway 결정 기록). 서비스는 값을 변환하거나 추측하지 않는다. Order(#265)와 같은 규칙이다.
 *
 * <ul>
 *   <li>두 헤더 중 하나라도 없거나 두 번 이상 오거나 형식이 틀리면 401 UNAUTHORIZED (Gateway 우회 대비 방어)
 *   <li>역할이 요청한 역할과 다르면 403 FORBIDDEN
 * </ul>
 */
public class CurrentUserArgumentResolver implements HandlerMethodArgumentResolver {

  static final String USER_ID_HEADER = "X-User-Id";
  static final String USER_ROLE_HEADER = "X-User-Role";

  /** 회원 ID는 JWT {@code sub}의 숫자 문자열이다. 0·앞자리 0·부호·공백·쉼표는 받지 않는다. */
  private static final Pattern USER_ID = Pattern.compile("[1-9][0-9]{0,17}");

  @Override
  public boolean supportsParameter(MethodParameter parameter) {
    Class<?> type = parameter.getParameterType();
    return parameter.hasParameterAnnotation(CurrentUser.class)
        && (type == Long.class || type == long.class);
  }

  @Override
  public Object resolveArgument(
      MethodParameter parameter,
      ModelAndViewContainer mavContainer,
      NativeWebRequest webRequest,
      WebDataBinderFactory binderFactory) {
    HttpServletRequest request = webRequest.getNativeRequest(HttpServletRequest.class);
    if (request == null) {
      throw new BusinessException(ErrorCode.UNAUTHORIZED);
    }
    long userId = parseUserId(singleValue(request, USER_ID_HEADER));
    UserRole role = parseRole(singleValue(request, USER_ROLE_HEADER));
    UserRole required = parameter.getParameterAnnotation(CurrentUser.class).value();
    if (role != required) {
      throw new BusinessException(ErrorCode.FORBIDDEN);
    }
    return userId;
  }

  /** 헤더가 정확히 한 번 온 경우의 값. 없거나 중복이면 401. */
  private static String singleValue(HttpServletRequest request, String name) {
    List<String> values = Collections.list(request.getHeaders(name));
    if (values.size() != 1) {
      throw new BusinessException(ErrorCode.UNAUTHORIZED);
    }
    return values.get(0);
  }

  private static long parseUserId(String value) {
    if (!USER_ID.matcher(value).matches()) {
      throw new BusinessException(ErrorCode.UNAUTHORIZED);
    }
    return Long.parseLong(value);
  }

  private static UserRole parseRole(String value) {
    for (UserRole role : UserRole.values()) {
      if (role.name().equals(value)) {
        return role;
      }
    }
    throw new BusinessException(ErrorCode.UNAUTHORIZED);
  }
}
