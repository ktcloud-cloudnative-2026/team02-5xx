package com.peakorder.payment.config;

import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Info;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class OpenApiConfig {

  @Bean
  public OpenAPI paymentServiceOpenApi() {
    return new OpenAPI().info(new Info().title("Payment Service API").version("v1"));
  }
}
