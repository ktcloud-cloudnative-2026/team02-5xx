package com.peakorder.inventory.config;

import java.net.http.HttpClient;
import java.time.Duration;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.web.client.RestClient;

/** 다른 서비스 호출용 RestClient. 주소는 환경 변수로 주입한다. */
@Configuration
public class RestClientConfig {

  private static final Duration CONNECT_TIMEOUT = Duration.ofSeconds(2);
  private static final Duration READ_TIMEOUT = Duration.ofSeconds(3);

  @Bean
  public RestClient menuRestClient(@Value("${clients.menu.base-url}") String baseUrl) {
    JdkClientHttpRequestFactory factory =
        new JdkClientHttpRequestFactory(
            HttpClient.newBuilder().connectTimeout(CONNECT_TIMEOUT).build());
    factory.setReadTimeout(READ_TIMEOUT);
    return RestClient.builder().baseUrl(baseUrl).requestFactory(factory).build();
  }
}
