package com.peakorder.inventory.config;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * 관리자 API(/api/v1/admin/**)에만 권한 검사를 붙인다. 고객 API(/api/v1/inventory/**)와 내부 API(/internal/v1/**)는
 * 대상이 아니다. 관리자 API가 꺼져 있으면 이 설정도 등록하지 않아 기존 404 동작을 유지한다.
 */
@Configuration
@ConditionalOnProperty(name = "inventory.admin.enabled", havingValue = "true")
public class AdminWebConfig implements WebMvcConfigurer {

  @Override
  public void addInterceptors(InterceptorRegistry registry) {
    registry.addInterceptor(new AdminAuthInterceptor()).addPathPatterns("/api/v1/admin/**");
  }
}
