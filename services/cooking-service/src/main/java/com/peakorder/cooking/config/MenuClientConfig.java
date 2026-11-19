package com.peakorder.cooking.config;

import java.net.http.HttpClient;
import java.time.Duration;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.web.client.RestClient;

/**
 * Menu 내부 API 호출 설정. 주소는 MENU_SERVICE_URL(로컬 기본값은 Order와 같은 http://localhost:8081, K8s에서는 Service
 * 주소를 환경 변수로 주입). 고객 화면 응답이 늦어지지 않도록 타임아웃을 짧게 둔다.
 */
@Configuration
public class MenuClientConfig {

  @Bean
  public RestClient menuRestClient(
      @Value("${menu.base-url:http://localhost:8081}") String baseUrl,
      @Value("${menu.connect-timeout-ms:1000}") long connectTimeoutMs,
      @Value("${menu.read-timeout-ms:2000}") long readTimeoutMs) {
    HttpClient httpClient =
        HttpClient.newBuilder().connectTimeout(Duration.ofMillis(connectTimeoutMs)).build();
    JdkClientHttpRequestFactory requestFactory = new JdkClientHttpRequestFactory(httpClient);
    requestFactory.setReadTimeout(Duration.ofMillis(readTimeoutMs));
    return RestClient.builder().baseUrl(baseUrl).requestFactory(requestFactory).build();
  }
}
