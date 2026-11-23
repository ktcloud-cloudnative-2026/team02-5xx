package com.peakorder.payment.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;

/**
 * PI-01 요청. idempotencyKey는 Order가 정한다(현재 "order-{orderId}").
 *
 * <p>유효성 오류 메시지는 한글로 직접 적는다. 400 응답의 message에 그대로 실린다.
 */
public record PaymentRequest(
    @NotNull(message = "orderId는 필수입니다.") @Positive(message = "orderId는 1 이상이어야 합니다.") Long orderId,
    @NotNull(message = "amount는 필수입니다.") @Positive(message = "amount는 0보다 커야 합니다.") Integer amount,
    @NotBlank(message = "idempotencyKey는 필수입니다.")
        @Size(max = 100, message = "idempotencyKey는 100자 이하여야 합니다.")
        String idempotencyKey) {}
