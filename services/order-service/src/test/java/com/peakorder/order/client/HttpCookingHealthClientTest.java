package com.peakorder.order.client;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withException;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import java.io.IOException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

class HttpCookingHealthClientTest {

  private MockRestServiceServer server;
  private HttpCookingHealthClient client;

  @BeforeEach
  void setUp() {
    RestClient.Builder builder = RestClient.builder().baseUrl("http://cooking");
    server = MockRestServiceServer.bindTo(builder).build();
    client = new HttpCookingHealthClient(builder.build());
  }

  @Test
  void up_response_is_healthy() {
    server
        .expect(requestTo("http://cooking/actuator/health"))
        .andExpect(method(HttpMethod.GET))
        .andRespond(withSuccess("{\"status\":\"UP\"}", MediaType.APPLICATION_JSON));

    assertThat(client.isUp()).isTrue();
    server.verify();
  }

  @Test
  void http_503_down_is_unhealthy() {
    server
        .expect(requestTo("http://cooking/actuator/health"))
        .andRespond(
            withStatus(HttpStatus.SERVICE_UNAVAILABLE)
                .body("{\"status\":\"DOWN\"}")
                .contentType(MediaType.APPLICATION_JSON));

    assertThat(client.isUp()).isFalse();
  }

  @Test
  void other_error_statuses_are_unhealthy() {
    server
        .expect(requestTo("http://cooking/actuator/health"))
        .andRespond(withStatus(HttpStatus.NOT_FOUND));

    assertThat(client.isUp()).isFalse();
  }

  @Test
  void connection_failure_or_timeout_is_unhealthy() {
    server
        .expect(requestTo("http://cooking/actuator/health"))
        .andRespond(withException(new IOException("connection refused")));

    assertThat(client.isUp()).isFalse();
  }
}
