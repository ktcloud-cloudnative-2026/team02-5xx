package com.peakorder.order.client;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withException;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import com.peakorder.order.client.InventoryClient.HoldLine;
import com.peakorder.order.client.InventoryClient.StockHold;
import com.peakorder.order.exception.BusinessException;
import com.peakorder.order.exception.ErrorCode;
import java.io.IOException;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

/** Inventory 담당(남규리)과 합의한 응답 의미(409 재고 부족·확보 비활성, 404 확보 없음)대로 해석하는지 확인한다. */
class HttpInventoryClientTest {

  private static final String HOLDS = "http://inventory/internal/v1/inventory/holds";

  private MockRestServiceServer server;
  private HttpInventoryClient client;

  @BeforeEach
  void setUp() {
    RestClient.Builder builder = RestClient.builder().baseUrl("http://inventory");
    server = MockRestServiceServer.bindTo(builder).build();
    client = new HttpInventoryClient(builder.build());
  }

  private ErrorCode codeOf(Runnable call) {
    try {
      call.run();
    } catch (BusinessException e) {
      return e.errorCode();
    }
    return null;
  }

  private void holdResponds(HttpStatus status) {
    server.expect(requestTo(HOLDS)).andRespond(withStatus(status));
  }

  private void confirmResponds(HttpStatus status) {
    server.expect(requestTo(HOLDS + "/901/confirm")).andRespond(withStatus(status));
  }

  @Test
  void hold_success_returns_hold_id_and_expiry() {
    server
        .expect(requestTo(HOLDS))
        .andExpect(method(HttpMethod.POST))
        .andRespond(
            withSuccess(
                "{\"success\":true,\"data\":{\"holdId\":901,\"expiresAt\":\"2026-11-16T10:05:00+09:00\"}}",
                MediaType.APPLICATION_JSON));

    StockHold hold = client.hold(1L, List.of(new HoldLine(1L, 2)));

    assertThat(hold.holdId()).isEqualTo(901L);
  }

  @Test
  void hold_409_means_out_of_stock() {
    holdResponds(HttpStatus.CONFLICT);

    assertThat(codeOf(() -> client.hold(1L, List.of(new HoldLine(1L, 2)))))
        .isEqualTo(ErrorCode.OUT_OF_STOCK);
  }

  @Test
  void hold_other_4xx_is_a_bad_request_not_an_out_of_stock_verdict() {
    holdResponds(HttpStatus.BAD_REQUEST);

    assertThat(codeOf(() -> client.hold(1L, List.of(new HoldLine(1L, 2)))))
        .isEqualTo(ErrorCode.UPSTREAM_INVALID_RESPONSE);
  }

  @Test
  void hold_5xx_or_connection_failure_is_unavailable() {
    holdResponds(HttpStatus.SERVICE_UNAVAILABLE);
    assertThat(codeOf(() -> client.hold(1L, List.of(new HoldLine(1L, 2)))))
        .isEqualTo(ErrorCode.INVENTORY_SERVICE_UNAVAILABLE);

    server.reset();
    server.expect(requestTo(HOLDS)).andRespond(withException(new IOException("refused")));
    assertThat(codeOf(() -> client.hold(1L, List.of(new HoldLine(1L, 2)))))
        .isEqualTo(ErrorCode.INVENTORY_SERVICE_UNAVAILABLE);
  }

  @Test
  void confirm_200_is_success_including_already_confirmed() {
    confirmResponds(HttpStatus.OK);

    client.confirm(901L);

    server.verify();
  }

  @Test
  void confirm_409_hold_not_active_and_404_not_found_are_definitive_failures() {
    confirmResponds(HttpStatus.CONFLICT);
    assertThat(codeOf(() -> client.confirm(901L))).isEqualTo(ErrorCode.STOCK_CONFIRM_FAILED);

    server.reset();
    confirmResponds(HttpStatus.NOT_FOUND);
    assertThat(codeOf(() -> client.confirm(901L))).isEqualTo(ErrorCode.STOCK_CONFIRM_FAILED);
  }

  @Test
  void confirm_other_4xx_is_not_treated_as_a_failure_that_triggers_a_refund() {
    for (HttpStatus status :
        List.of(HttpStatus.BAD_REQUEST, HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)) {
      server.reset();
      confirmResponds(status);

      assertThat(codeOf(() -> client.confirm(901L)))
          .as(status.toString())
          .isEqualTo(ErrorCode.UPSTREAM_INVALID_RESPONSE);
    }
  }

  @Test
  void confirm_5xx_or_connection_failure_means_unknown_result() {
    confirmResponds(HttpStatus.INTERNAL_SERVER_ERROR);
    assertThat(codeOf(() -> client.confirm(901L)))
        .isEqualTo(ErrorCode.INVENTORY_SERVICE_UNAVAILABLE);

    server.reset();
    server
        .expect(requestTo(HOLDS + "/901/confirm"))
        .andRespond(withException(new IOException("timeout")));
    assertThat(codeOf(() -> client.confirm(901L)))
        .isEqualTo(ErrorCode.INVENTORY_SERVICE_UNAVAILABLE);
  }

  @Test
  void release_success_and_failure() {
    server
        .expect(requestTo(HOLDS + "/901"))
        .andExpect(method(HttpMethod.DELETE))
        .andRespond(withStatus(HttpStatus.OK));
    client.release(901L);

    server.reset();
    server.expect(requestTo(HOLDS + "/901")).andRespond(withStatus(HttpStatus.SERVICE_UNAVAILABLE));
    assertThatThrownBy(() -> client.release(901L))
        .isInstanceOfSatisfying(
            BusinessException.class,
            e -> assertThat(e.errorCode()).isEqualTo(ErrorCode.INVENTORY_SERVICE_UNAVAILABLE));
  }
}
