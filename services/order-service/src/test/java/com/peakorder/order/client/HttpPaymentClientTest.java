package com.peakorder.order.client;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withException;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import com.peakorder.order.exception.BusinessException;
import com.peakorder.order.exception.ErrorCode;
import java.io.IOException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

/** Payment 담당(정진혁)과 확인한 PI-03 환불 응답(200 REFUNDED·멱등 / 409 환불 불가 / 404 없는 결제)대로 해석하는지 확인한다. */
class HttpPaymentClientTest {

  private static final String REFUND = "http://payment/internal/v1/payments/9/refund";

  private MockRestServiceServer server;
  private HttpPaymentClient client;

  @BeforeEach
  void setUp() {
    RestClient.Builder builder = RestClient.builder().baseUrl("http://payment");
    server = MockRestServiceServer.bindTo(builder).build();
    client = new HttpPaymentClient(builder.build());
  }

  private ErrorCode errorOf() {
    try {
      client.refund(9L);
    } catch (BusinessException e) {
      return e.errorCode();
    }
    return null;
  }

  private void respondsOk(String body) {
    server
        .expect(requestTo(REFUND))
        .andExpect(method(HttpMethod.POST))
        .andRespond(withSuccess(body, MediaType.APPLICATION_JSON));
  }

  @Test
  void refunded_response_is_a_confirmed_refund() {
    respondsOk(
        "{\"success\":true,\"data\":{\"paymentId\":9,\"status\":\"REFUNDED\"},\"message\":\"OK\"}");

    assertThatCode(() -> client.refund(9L)).doesNotThrowAnyException();
  }

  @Test
  void a_success_response_that_does_not_say_refunded_is_not_taken_as_a_refund() {
    respondsOk(
        "{\"success\":true,\"data\":{\"paymentId\":9,\"status\":\"SUCCESS\"},\"message\":\"OK\"}");
    assertThat(errorOf()).isEqualTo(ErrorCode.UPSTREAM_INVALID_RESPONSE);

    server.reset();
    respondsOk("{\"success\":true,\"message\":\"OK\"}");
    assertThat(errorOf()).isEqualTo(ErrorCode.UPSTREAM_INVALID_RESPONSE);

    server.reset();
    respondsOk(
        "{\"success\":true,\"data\":{\"paymentId\":10,\"status\":\"REFUNDED\"},\"message\":\"OK\"}");
    assertThat(errorOf()).isEqualTo(ErrorCode.UPSTREAM_INVALID_RESPONSE);
  }

  @Test
  void conflict_means_not_refundable_and_other_client_errors_are_contract_violations() {
    server.expect(requestTo(REFUND)).andRespond(withStatus(HttpStatus.CONFLICT));
    assertThat(errorOf()).isEqualTo(ErrorCode.PAYMENT_NOT_REFUNDABLE);

    server.reset();
    server.expect(requestTo(REFUND)).andRespond(withStatus(HttpStatus.NOT_FOUND));
    assertThat(errorOf()).isEqualTo(ErrorCode.UPSTREAM_INVALID_RESPONSE);

    server.reset();
    server.expect(requestTo(REFUND)).andRespond(withStatus(HttpStatus.BAD_REQUEST));
    assertThat(errorOf()).isEqualTo(ErrorCode.UPSTREAM_INVALID_RESPONSE);
  }

  @Test
  void server_errors_and_connection_failures_are_retryable() {
    server.expect(requestTo(REFUND)).andRespond(withStatus(HttpStatus.BAD_GATEWAY));
    assertThat(errorOf()).isEqualTo(ErrorCode.PAYMENT_SERVICE_UNAVAILABLE);

    server.reset();
    server.expect(requestTo(REFUND)).andRespond(withException(new IOException("timeout")));
    assertThat(errorOf()).isEqualTo(ErrorCode.PAYMENT_SERVICE_UNAVAILABLE);
  }
}
