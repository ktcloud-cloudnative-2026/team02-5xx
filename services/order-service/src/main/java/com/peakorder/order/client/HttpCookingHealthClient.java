package com.peakorder.order.client;

import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

@Component
public class HttpCookingHealthClient implements CookingHealthClient {

  private final RestClient restClient;

  public HttpCookingHealthClient(@Qualifier("cookingRestClient") RestClient restClient) {
    this.restClient = restClient;
  }

  @Override
  public boolean isUp() {
    try {
      restClient.get().uri("/actuator/health").retrieve().toBodilessEntity();
      return true;
    } catch (RestClientException e) {
      // 4xx·5xx(DOWN은 503), 연결 실패, 타임아웃 모두 "정상 아님"으로 본다.
      return false;
    }
  }
}
