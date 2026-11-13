package com.peakorder.payment.exception;

import static org.assertj.core.api.Assertions.assertThat;

import com.peakorder.payment.dto.ApiResponse;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

class GlobalExceptionHandlerTest {

  private final GlobalExceptionHandler handler = new GlobalExceptionHandler();

  @Test
  void business_exception_maps_to_common_failure_format() {
    ResponseEntity<ApiResponse<Void>> res =
        handler.handleBusiness(new BusinessException(ErrorCode.PAYMENT_NOT_FOUND));

    assertThat(res.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
    assertThat(res.getBody().success()).isFalse();
    assertThat(res.getBody().errorCode()).isEqualTo("PAYMENT_NOT_FOUND");
  }

  @Test
  void unexpected_exception_hides_detail() {
    ResponseEntity<ApiResponse<Void>> res =
        handler.handleUnexpected(new RuntimeException("secret"));

    assertThat(res.getStatusCode()).isEqualTo(HttpStatus.INTERNAL_SERVER_ERROR);
    assertThat(res.getBody().message()).doesNotContain("secret");
  }

  @Test
  void unknown_path_is_404_not_500() {
    ResponseEntity<ApiResponse<Void>> res =
        handler.handleNotFound(
            new org.springframework.web.servlet.resource.NoResourceFoundException(
                org.springframework.http.HttpMethod.GET, "/api/v1/none", "/api/v1/none"));

    assertThat(res.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
    assertThat(res.getBody().errorCode()).isEqualTo("NOT_FOUND");
  }
}
