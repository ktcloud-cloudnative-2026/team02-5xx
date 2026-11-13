package com.peakorder.order.dto;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class ApiResponseTest {

  @Test
  void ok_has_success_data_message() {
    ApiResponse<String> r = ApiResponse.ok("x");
    assertThat(r.success()).isTrue();
    assertThat(r.data()).isEqualTo("x");
    assertThat(r.message()).isEqualTo("OK");
    assertThat(r.errorCode()).isNull();
  }

  @Test
  void fail_has_errorCode() {
    ApiResponse<Void> r = ApiResponse.fail("INVALID_REQUEST", "bad");
    assertThat(r.success()).isFalse();
    assertThat(r.errorCode()).isEqualTo("INVALID_REQUEST");
  }
}
