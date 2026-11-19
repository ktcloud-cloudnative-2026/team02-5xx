package com.peakorder.payment.controller;

import com.peakorder.payment.dto.ApiResponse;
import com.peakorder.payment.dto.PaymentRequest;
import com.peakorder.payment.dto.PaymentResponse;
import com.peakorder.payment.service.PaymentService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.ExampleObject;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
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
  @ApiResponses({
    @io.swagger.v3.oas.annotations.responses.ApiResponse(
        responseCode = "200",
        description = "결제 처리됨(SUCCESS 또는 FAILED). 같은 요청 재전송도 처음 결과로 200"),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(
        responseCode = "400",
        description = "요청 값 오류",
        content =
            @Content(
                examples =
                    @ExampleObject(
                        name = "INVALID_REQUEST",
                        value =
                            "{\"success\":false,\"message\":\"amount: 0보다 커야 합니다\",\"errorCode\":\"INVALID_REQUEST\"}"))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(
        responseCode = "409",
        description = "중복 결제 거절",
        content =
            @Content(
                examples = {
                  @ExampleObject(
                      name = "IDEMPOTENCY_KEY_CONFLICT",
                      summary = "같은 idempotencyKey인데 orderId·amount가 다름",
                      value =
                          "{\"success\":false,\"message\":\"같은 idempotencyKey로 다른 결제 요청이 들어왔습니다.\",\"errorCode\":\"IDEMPOTENCY_KEY_CONFLICT\"}"),
                  @ExampleObject(
                      name = "PAYMENT_ALREADY_EXISTS",
                      summary = "이미 결제 기록이 있는 orderId",
                      value =
                          "{\"success\":false,\"message\":\"이미 결제 기록이 있는 주문입니다. 재시도는 새 주문으로 해 주세요.\",\"errorCode\":\"PAYMENT_ALREADY_EXISTS\"}")
                }))
  })
  @PostMapping
  public ApiResponse<PaymentResponse> pay(@Valid @RequestBody PaymentRequest request) {
    return ApiResponse.ok(paymentService.pay(request));
  }

  @Operation(summary = "PI-02 결제 결과 조회")
  @ApiResponses({
    @io.swagger.v3.oas.annotations.responses.ApiResponse(
        responseCode = "200",
        description = "조회 성공"),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(
        responseCode = "404",
        description = "없는 paymentId",
        content =
            @Content(
                examples =
                    @ExampleObject(
                        name = "PAYMENT_NOT_FOUND",
                        value =
                            "{\"success\":false,\"message\":\"결제 정보를 찾을 수 없습니다.\",\"errorCode\":\"PAYMENT_NOT_FOUND\"}")))
  })
  @GetMapping("/{paymentId}")
  public ApiResponse<PaymentResponse> get(@PathVariable Long paymentId) {
    return ApiResponse.ok(paymentService.get(paymentId));
  }

  @Operation(summary = "PI-03 환불", description = "이미 환불된 결제는 같은 200으로 응답한다.")
  @ApiResponses({
    @io.swagger.v3.oas.annotations.responses.ApiResponse(
        responseCode = "200",
        description = "환불 완료(REFUNDED). 이미 환불된 결제도 같은 200"),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(
        responseCode = "404",
        description = "없는 paymentId",
        content =
            @Content(
                examples =
                    @ExampleObject(
                        name = "PAYMENT_NOT_FOUND",
                        value =
                            "{\"success\":false,\"message\":\"결제 정보를 찾을 수 없습니다.\",\"errorCode\":\"PAYMENT_NOT_FOUND\"}"))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(
        responseCode = "409",
        description = "승인(SUCCESS)되지 않은 결제는 환불 불가",
        content =
            @Content(
                examples =
                    @ExampleObject(
                        name = "PAYMENT_NOT_REFUNDABLE",
                        value =
                            "{\"success\":false,\"message\":\"환불할 수 없는 결제입니다(승인된 결제만 환불 가능).\",\"errorCode\":\"PAYMENT_NOT_REFUNDABLE\"}")))
  })
  @PostMapping("/{paymentId}/refund")
  public ApiResponse<PaymentResponse> refund(@PathVariable Long paymentId) {
    return ApiResponse.ok(paymentService.refund(paymentId));
  }
}
