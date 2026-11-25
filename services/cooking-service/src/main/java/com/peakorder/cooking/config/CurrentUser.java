package com.peakorder.cooking.config;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * 컨트롤러 메서드의 사용자 ID({@code Long}) 파라미터에 붙인다. Gateway가 전달한 {@code X-User-Id}·{@code X-User-Role} 헤더를
 * 확인해, 헤더가 없거나 형식이 틀리면 401 UNAUTHORIZED, 역할이 {@link #value()}와 다르면 403 FORBIDDEN으로 응답한다(#112, #99).
 * 확인을 통과하면 {@code X-User-Id}의 값이 들어온다. Order(#265)와 같은 규칙이다.
 */
@Target(ElementType.PARAMETER)
@Retention(RetentionPolicy.RUNTIME)
@Documented
public @interface CurrentUser {

  /** 이 요청을 처리할 수 있는 역할 */
  UserRole value();
}
