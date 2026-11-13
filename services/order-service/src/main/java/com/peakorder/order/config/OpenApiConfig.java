package com.peakorder.order.config;

import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Info;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class OpenApiConfig {

  @Bean
  public OpenAPI orderServiceOpenApi() {
    return new OpenAPI().info(new Info().title("Order Service API").version("v1"));
  }
}
