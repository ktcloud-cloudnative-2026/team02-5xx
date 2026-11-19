package com.peakorder.order.client;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withException;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import com.peakorder.order.client.CookingClient.CancelResult;
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

/** Cooking 담당(김지윤)과 합의한 CI-03 응답(200 / 409 조리 시작·완료 / 404 전표 없음)대로 해석하는지 확인한다. */
class HttpCookingClientTest {

  private static final String CANCEL = "http://cooking/internal/v1/cooking/orders/100/cancel";

  private MockRestServiceServer server;
  private HttpCookingClient client;

  @BeforeEach
  void setUp() {
    RestClient.Builder builder = RestClient.builder().baseUrl("http://cooking");
    server = MockRestServiceServer.bindTo(builder).build();
    client = new HttpCookingClient(builder.build(), builder.build());
  }

  private void respondsWithError(HttpStatus status, String errorCode) {
    server
        .expect(requestTo(CANCEL))
        .andExpect(method(HttpMethod.POST))
        .andRespond(
            withStatus(status)
                .contentType(MediaType.APPLICATION_JSON)
                .body("{\"success\":false,\"message\":\"x\",\"errorCode\":\"" + errorCode + "\"}"));
  }

  private ErrorCode errorOf() {
    try {
      client.cancel(100L);
    } catch (BusinessException e) {
      return e.errorCode();
    }
    return null;
  }

  @Test
  void canceled_response_is_a_confirmed_cancellation() {
    server
        .expect(requestTo(CANCEL))
        .andExpect(method(HttpMethod.POST))
        .andRespond(
            withSuccess(
                "{\"success\":true,\"data\":{\"orderId\":100,\"status\":\"CANCELED\"},\"message\":\"OK\"}",
                MediaType.APPLICATION_JSON));

    assertThat(client.cancel(100L)).isEqualTo(CancelResult.CANCELED);
  }

  @Test
  void a_success_response_that_does_not_say_canceled_is_not_taken_as_a_cancellation() {
    server
        .expect(requestTo(CANCEL))
        .andRespond(
            withSuccess(
                "{\"success\":true,\"data\":{\"orderId\":100,\"status\":\"WAITING\"},\"message\":\"OK\"}",
                MediaType.APPLICATION_JSON));

    assertThat(errorOf()).isEqualTo(ErrorCode.UPSTREAM_INVALID_RESPONSE);
  }

  @Test
  void conflict_with_the_agreed_codes_means_cooking_already_started_or_done() {
    respondsWithError(HttpStatus.CONFLICT, "COOKING_ALREADY_STARTED");
    assertThat(client.cancel(100L)).isEqualTo(CancelResult.ALREADY_STARTED);

    server.reset();
    respondsWithError(HttpStatus.CONFLICT, "COOKING_ALREADY_DONE");
    assertThat(client.cancel(100L)).isEqualTo(CancelResult.ALREADY_DONE);
  }

  @Test
  void not_found_with_the_ticket_code_means_still_being_accepted() {
    respondsWithError(HttpStatus.NOT_FOUND, "COOKING_TICKET_NOT_FOUND");

    assertThat(client.cancel(100L)).isEqualTo(CancelResult.TICKET_NOT_FOUND);
  }

  @Test
  void a_404_without_the_ticket_code_is_a_contract_violation_not_a_pending_order() {
    // 경로 오류 등으로 오는 404를 "접수 처리 중"으로 오해하지 않는다.
    server.expect(requestTo(CANCEL)).andRespond(withStatus(HttpStatus.NOT_FOUND));

    assertThat(errorOf()).isEqualTo(ErrorCode.UPSTREAM_INVALID_RESPONSE);
  }

  @Test
  void other_client_errors_and_unknown_conflicts_are_contract_violations() {
    respondsWithError(HttpStatus.BAD_REQUEST, "INVALID_REQUEST");
    assertThat(errorOf()).isEqualTo(ErrorCode.UPSTREAM_INVALID_RESPONSE);

    server.reset();
    respondsWithError(HttpStatus.CONFLICT, "SOMETHING_ELSE");
    assertThat(errorOf()).isEqualTo(ErrorCode.UPSTREAM_INVALID_RESPONSE);
  }

  @Test
  void server_errors_and_connection_failures_mean_the_result_is_unknown() {
    server.expect(requestTo(CANCEL)).andRespond(withStatus(HttpStatus.INTERNAL_SERVER_ERROR));
    assertThat(errorOf()).isEqualTo(ErrorCode.COOKING_SERVICE_UNAVAILABLE);

    server.reset();
    server.expect(requestTo(CANCEL)).andRespond(withException(new IOException("timeout")));
    assertThat(errorOf()).isEqualTo(ErrorCode.COOKING_SERVICE_UNAVAILABLE);
  }

  // ---- CI-02 조리 상태 조회 ----

  private static final String STATUS = "http://cooking/internal/v1/cooking/orders/100";

  private void statusReturns(String data) {
    server
        .expect(requestTo(STATUS))
        .andExpect(method(HttpMethod.GET))
        .andRespond(
            withSuccess(
                "{\"success\":true,\"data\":" + data + ",\"message\":\"OK\"}",
                MediaType.APPLICATION_JSON));
  }

  private ErrorCode statusErrorOf() {
    try {
      client.getStatus(100L);
    } catch (BusinessException e) {
      return e.errorCode();
    }
    return null;
  }

  @Test
  void new_contract_values_are_passed_through() {
    statusReturns(
        "{\"orderId\":100,\"status\":\"WAITING\",\"waitingAhead\":2,\"estimatedCookSec\":120,"
            + "\"expectedWaitSec\":300,\"expectedReadySec\":420}");

    var s = client.getStatus(100L).orElseThrow();

    assertThat(s.status()).isEqualTo("WAITING");
    assertThat(s.waitingAhead()).isEqualTo(2);
    assertThat(s.estimatedCookSec()).isEqualTo(120);
    assertThat(s.expectedWaitSec()).isEqualTo(300);
    assertThat(s.expectedReadySec()).isEqualTo(420);
  }

  @Test
  void old_contract_waiting_converts_wait_to_until_start() {
    // 변경 전 Cooking: expectedWaitSec가 완료까지 시간이고 expectedReadySec가 없다.
    statusReturns(
        "{\"orderId\":100,\"status\":\"WAITING\",\"waitingAhead\":2,\"estimatedCookSec\":120,\"expectedWaitSec\":420}");

    var s = client.getStatus(100L).orElseThrow();

    assertThat(s.expectedReadySec()).isEqualTo(420);
    assertThat(s.expectedWaitSec()).isEqualTo(300);
  }

  @Test
  void old_contract_cooking_has_no_wait_and_ready_is_the_remaining_time() {
    statusReturns(
        "{\"orderId\":100,\"status\":\"COOKING\",\"waitingAhead\":0,\"estimatedCookSec\":120,\"expectedWaitSec\":45,"
            + "\"startedAt\":\"2026-11-19T10:00:00+09:00\"}");

    var s = client.getStatus(100L).orElseThrow();

    assertThat(s.expectedWaitSec()).isZero();
    assertThat(s.expectedReadySec()).isEqualTo(45);
    assertThat(s.startedAt()).isNotNull();
  }

  @Test
  void old_contract_done_and_canceled_are_zero() {
    statusReturns(
        "{\"orderId\":100,\"status\":\"DONE\",\"waitingAhead\":0,\"estimatedCookSec\":120,\"expectedWaitSec\":0}");

    var s = client.getStatus(100L).orElseThrow();

    assertThat(s.expectedWaitSec()).isZero();
    assertThat(s.expectedReadySec()).isZero();
  }

  @Test
  void missing_ticket_is_empty_not_an_error() {
    server
        .expect(requestTo(STATUS))
        .andRespond(
            withStatus(HttpStatus.NOT_FOUND)
                .contentType(MediaType.APPLICATION_JSON)
                .body(
                    "{\"success\":false,\"message\":\"x\",\"errorCode\":\"COOKING_TICKET_NOT_FOUND\"}"));

    assertThat(client.getStatus(100L)).isEmpty();
  }

  @Test
  void status_failures_are_split_into_unavailable_and_invalid() {
    server.expect(requestTo(STATUS)).andRespond(withStatus(HttpStatus.SERVICE_UNAVAILABLE));
    assertThat(statusErrorOf()).isEqualTo(ErrorCode.COOKING_SERVICE_UNAVAILABLE);

    server.reset();
    server.expect(requestTo(STATUS)).andRespond(withException(new IOException("timeout")));
    assertThat(statusErrorOf()).isEqualTo(ErrorCode.COOKING_SERVICE_UNAVAILABLE);

    server.reset();
    server.expect(requestTo(STATUS)).andRespond(withStatus(HttpStatus.NOT_FOUND));
    assertThat(statusErrorOf()).isEqualTo(ErrorCode.UPSTREAM_INVALID_RESPONSE);

    server.reset();
    server.expect(requestTo(STATUS)).andRespond(withStatus(HttpStatus.BAD_REQUEST));
    assertThat(statusErrorOf()).isEqualTo(ErrorCode.UPSTREAM_INVALID_RESPONSE);
  }

  @Test
  void contract_violating_bodies_are_invalid() {
    statusReturns(
        "{\"orderId\":100,\"status\":\"SOMETHING\",\"waitingAhead\":0,\"estimatedCookSec\":1,\"expectedWaitSec\":0}");
    assertThat(statusErrorOf()).isEqualTo(ErrorCode.UPSTREAM_INVALID_RESPONSE);

    server.reset();
    statusReturns(
        "{\"orderId\":100,\"status\":\"WAITING\",\"estimatedCookSec\":1,\"expectedWaitSec\":0}");
    assertThat(statusErrorOf()).isEqualTo(ErrorCode.UPSTREAM_INVALID_RESPONSE);

    server.reset();
    statusReturns(
        "{\"orderId\":100,\"status\":\"WAITING\",\"waitingAhead\":0,\"estimatedCookSec\":1,\"expectedWaitSec\":-5}");
    assertThat(statusErrorOf()).isEqualTo(ErrorCode.UPSTREAM_INVALID_RESPONSE);
  }

  @Test
  void response_for_another_or_missing_order_id_is_invalid() {
    statusReturns(
        "{\"orderId\":200,\"status\":\"WAITING\",\"waitingAhead\":0,\"estimatedCookSec\":1,\"expectedWaitSec\":0,\"expectedReadySec\":1}");
    assertThat(statusErrorOf()).isEqualTo(ErrorCode.UPSTREAM_INVALID_RESPONSE);

    server.reset();
    statusReturns(
        "{\"status\":\"WAITING\",\"waitingAhead\":0,\"estimatedCookSec\":1,\"expectedWaitSec\":0,\"expectedReadySec\":1}");
    assertThat(statusErrorOf()).isEqualTo(ErrorCode.UPSTREAM_INVALID_RESPONSE);

    server.reset();
    statusReturns(
        "{\"orderId\":null,\"status\":\"WAITING\",\"waitingAhead\":0,\"estimatedCookSec\":1,\"expectedWaitSec\":0,\"expectedReadySec\":1}");
    assertThat(statusErrorOf()).isEqualTo(ErrorCode.UPSTREAM_INVALID_RESPONSE);
  }

  @Test
  void response_for_the_requested_order_id_is_accepted() {
    statusReturns(
        "{\"orderId\":100,\"status\":\"WAITING\",\"waitingAhead\":0,\"estimatedCookSec\":1,\"expectedWaitSec\":0,\"expectedReadySec\":1}");

    assertThat(client.getStatus(100L)).isPresent();
  }
}
