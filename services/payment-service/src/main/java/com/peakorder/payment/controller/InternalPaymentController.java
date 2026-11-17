package com.peakorder.payment.controller;

import com.peakorder.payment.dto.ApiResponse;
import com.peakorder.payment.dto.PaymentRequest;
import com.peakorder.payment.dto.PaymentResponse;
import com.peakorder.payment.service.PaymentService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Order만 호출하는 내부 API. Gateway로 외부에 열지 않는다. */
@Tag(name = "Payment 내부 API", description = "Order → Payment")
@RestController
@RequestMapping("/internal/v1/payments")
public class InternalPaymentController {

  private final PaymentService paymentService;

  public InternalPaymentController(PaymentService paymentService) {
    this.paymentService = paymentService;
  }

  @Operation(summary = "PI-01 모의 결제", description = "같은 idempotencyKey 재요청은 처음 결과를 그대로 돌려준다.")
  @PostMapping
  public ApiResponse<PaymentResponse> pay(@Valid @RequestBody PaymentRequest request) {
    return ApiResponse.ok(paymentService.pay(request));
  }

  @Operation(summary = "PI-02 결제 결과 조회")
  @GetMapping("/{paymentId}")
  public ApiResponse<PaymentResponse> get(@PathVariable Long paymentId) {
    return ApiResponse.ok(paymentService.get(paymentId));
  }

  @Operation(summary = "PI-03 환불", description = "이미 환불된 결제는 같은 200으로 응답한다.")
  @PostMapping("/{paymentId}/refund")
  public ApiResponse<PaymentResponse> refund(@PathVariable Long paymentId) {
    return ApiResponse.ok(paymentService.refund(paymentId));
  }
}
