package com.peakorder.order.config;

import java.net.http.HttpClient;
import java.time.Duration;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.web.client.RestClient;

/** 내부 서비스 호출용 RestClient. 주소는 환경 변수로 주입한다. */
@Configuration
public class RestClientConfig {

  private static final Duration CONNECT_TIMEOUT = Duration.ofSeconds(2);
  private static final Duration READ_TIMEOUT = Duration.ofSeconds(3);

  /** 헬스 확인: 연결 1초 + 응답 2초, 한 번 확인에 최악 약 3초(5초 주기 안에서 끝난다). */
  private static final Duration HEALTH_CONNECT_TIMEOUT = Duration.ofSeconds(1);

  private static final Duration HEALTH_TIMEOUT = Duration.ofSeconds(2);

  @Bean
  public RestClient menuRestClient(@Value("${clients.menu.base-url}") String baseUrl) {
    return build(baseUrl);
  }

  @Bean
  public RestClient inventoryRestClient(@Value("${clients.inventory.base-url}") String baseUrl) {
    return build(baseUrl);
  }

  @Bean
  public RestClient paymentRestClient(@Value("${clients.payment.base-url}") String baseUrl) {
    return build(baseUrl);
  }

  /** Cooking 헬스 확인용. 합의한 응답 타임아웃 2초에 연결 타임아웃 1초를 더한다. */
  @Bean
  public RestClient cookingRestClient(@Value("${clients.cooking.base-url}") String baseUrl) {
    return build(baseUrl, HEALTH_CONNECT_TIMEOUT, HEALTH_TIMEOUT);
  }

  /** 주문 상세의 조리 상태 조회(CI-02)용. 고객 화면 응답이 느려지지 않도록 헬스와 같은 짧은 타임아웃(연결 1초·응답 2초)을 쓴다. */
  @Bean
  public RestClient cookingQueryRestClient(@Value("${clients.cooking.base-url}") String baseUrl) {
    return build(baseUrl, HEALTH_CONNECT_TIMEOUT, HEALTH_TIMEOUT);
  }

  /** Cooking 취소(CI-03)용. 헬스와 달리 전표 행 잠금을 기다릴 수 있어 응답 대기를 3초로 둔다. */
  @Bean
  public RestClient cookingCommandRestClient(@Value("${clients.cooking.base-url}") String baseUrl) {
    return build(baseUrl);
  }

  private RestClient build(String baseUrl) {
    return build(baseUrl, CONNECT_TIMEOUT, READ_TIMEOUT);
  }

  private RestClient build(String baseUrl, Duration connectTimeout, Duration readTimeout) {
    JdkClientHttpRequestFactory factory =
        new JdkClientHttpRequestFactory(
            HttpClient.newBuilder().connectTimeout(connectTimeout).build());
    factory.setReadTimeout(readTimeout);
    return RestClient.builder().baseUrl(baseUrl).requestFactory(factory).build();
  }
}
