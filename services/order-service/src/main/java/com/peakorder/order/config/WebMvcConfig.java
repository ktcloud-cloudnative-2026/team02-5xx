package com.peakorder.order.config;

import java.util.List;
import org.springdoc.core.utils.SpringDocUtils;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.method.support.HandlerMethodArgumentResolver;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/** {@link CurrentUser} 파라미터를 처리하는 해석기를 등록한다. */
@Configuration
public class WebMvcConfig implements WebMvcConfigurer {

  static {
    // 사용자 ID는 헤더에서 오므로 Swagger 문서에 요청 파라미터로 나타나지 않게 한다.
    SpringDocUtils.getConfig().addAnnotationsToIgnore(CurrentUser.class);
  }

  @Override
  public void addArgumentResolvers(List<HandlerMethodArgumentResolver> resolvers) {
    resolvers.add(new CurrentUserArgumentResolver());
  }
}
