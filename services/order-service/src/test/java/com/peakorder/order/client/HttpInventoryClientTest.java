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
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
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
  private SimpleMeterRegistry registry;

  @BeforeEach
  void setUp() {
    RestClient.Builder builder = RestClient.builder().baseUrl("http://inventory");
    server = MockRestServiceServer.bindTo(builder).build();
    registry = new SimpleMeterRegistry();
    client = new HttpInventoryClient(builder.build(), registry);
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

  private double rejected(String reason) {
    var counter = registry.find("order.inventory.hold.rejected").tag("reason", reason).counter();
    return counter == null ? 0 : counter.count();
  }

  private void holdConflict(String body) {
    server
        .expect(requestTo(HOLDS))
        .andRespond(
            withStatus(HttpStatus.CONFLICT)
                .contentType(org.springframework.http.MediaType.APPLICATION_JSON)
                .body(body));
  }

  @Test
  void hold_409_insufficient_stock_is_counted_separately_but_still_out_of_stock() {
    holdConflict(
        "{\"success\":false,\"message\":\"재고가 부족합니다.\",\"errorCode\":\"INSUFFICIENT_STOCK\"}");

    assertThat(codeOf(() -> client.hold(1L, List.of(new HoldLine(1L, 2)))))
        .isEqualTo(ErrorCode.OUT_OF_STOCK);
    assertThat(rejected("insufficient_stock")).isEqualTo(1);
    assertThat(rejected("stock_not_linked")).isZero();
  }

  @Test
  void hold_409_stock_not_linked_is_counted_separately_but_still_out_of_stock() {
    holdConflict("{\"success\":false,\"message\":\"연결 안 됨\",\"errorCode\":\"STOCK_NOT_LINKED\"}");

    assertThat(codeOf(() -> client.hold(1L, List.of(new HoldLine(7L, 2)))))
        .isEqualTo(ErrorCode.OUT_OF_STOCK);
    assertThat(rejected("stock_not_linked")).isEqualTo(1);
    assertThat(rejected("insufficient_stock")).isZero();
  }

  @Test
  void hold_409_with_unknown_missing_or_unreadable_body_is_unknown_but_still_out_of_stock() {
    for (String body :
        new String[] {
          "{\"success\":false,\"errorCode\":\"SOMETHING_NEW\"}",
          "{\"success\":false}",
          "not json",
          ""
        }) {
      server.reset();
      holdConflict(body);
      assertThat(codeOf(() -> client.hold(1L, List.of(new HoldLine(1L, 2)))))
          .isEqualTo(ErrorCode.OUT_OF_STOCK);
    }
    assertThat(rejected("unknown")).isEqualTo(4);
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

  // ---- 주문 취소: 확보 해제(II-03)와 재고 복원(II-04) ----

  private static final String HOLD_55 = "http://inventory/internal/v1/inventory/holds/55";
  private static final String RESTORATIONS = "http://inventory/internal/v1/inventory/restorations";

  @Test
  void release_hold_treats_200_and_404_as_released_and_409_as_already_confirmed() {
    server
        .expect(requestTo(HOLD_55))
        .andExpect(method(HttpMethod.DELETE))
        .andRespond(withSuccess());
    assertThat(client.releaseHold(55L)).isEqualTo(InventoryClient.HoldRelease.RELEASED);

    server.reset();
    server.expect(requestTo(HOLD_55)).andRespond(withStatus(HttpStatus.NOT_FOUND));
    assertThat(client.releaseHold(55L)).isEqualTo(InventoryClient.HoldRelease.RELEASED);

    server.reset();
    server.expect(requestTo(HOLD_55)).andRespond(withStatus(HttpStatus.CONFLICT));
    assertThat(client.releaseHold(55L)).isEqualTo(InventoryClient.HoldRelease.ALREADY_CONFIRMED);
  }

  @Test
  void release_hold_other_client_errors_are_contract_violations_and_5xx_is_unknown() {
    server.expect(requestTo(HOLD_55)).andRespond(withStatus(HttpStatus.BAD_REQUEST));
    assertThat(codeOf(() -> client.releaseHold(55L)))
        .isEqualTo(ErrorCode.UPSTREAM_INVALID_RESPONSE);

    server.reset();
    server.expect(requestTo(HOLD_55)).andRespond(withStatus(HttpStatus.SERVICE_UNAVAILABLE));
    assertThat(codeOf(() -> client.releaseHold(55L)))
        .isEqualTo(ErrorCode.INVENTORY_SERVICE_UNAVAILABLE);

    server.reset();
    server.expect(requestTo(HOLD_55)).andRespond(withException(new IOException("timeout")));
    assertThat(codeOf(() -> client.releaseHold(55L)))
        .isEqualTo(ErrorCode.INVENTORY_SERVICE_UNAVAILABLE);
  }

  @Test
  void restore_sends_only_the_order_id_and_treats_200_as_restored() {
    server
        .expect(requestTo(RESTORATIONS))
        .andExpect(method(HttpMethod.POST))
        .andExpect(
            org.springframework.test.web.client.match.MockRestRequestMatchers.content()
                .json("{\"orderId\":100}", true))
        .andRespond(withSuccess());

    assertThat(client.restore(100L)).isEqualTo(InventoryClient.RestoreResult.RESTORED);
  }

  @Test
  void restore_409_is_not_applicable_other_4xx_is_invalid_and_5xx_is_unknown() {
    server.expect(requestTo(RESTORATIONS)).andRespond(withStatus(HttpStatus.CONFLICT));
    assertThat(client.restore(100L)).isEqualTo(InventoryClient.RestoreResult.NOT_APPLICABLE);

    server.reset();
    server.expect(requestTo(RESTORATIONS)).andRespond(withStatus(HttpStatus.NOT_FOUND));
    assertThat(codeOf(() -> client.restore(100L))).isEqualTo(ErrorCode.UPSTREAM_INVALID_RESPONSE);

    server.reset();
    server.expect(requestTo(RESTORATIONS)).andRespond(withStatus(HttpStatus.BAD_GATEWAY));
    assertThat(codeOf(() -> client.restore(100L)))
        .isEqualTo(ErrorCode.INVENTORY_SERVICE_UNAVAILABLE);
  }
}
