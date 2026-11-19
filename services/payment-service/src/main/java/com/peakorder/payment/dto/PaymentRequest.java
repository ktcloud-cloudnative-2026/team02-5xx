package com.peakorder.payment.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;

/** PI-01 요청. idempotencyKey는 Order가 정한다(현재 "order-{orderId}"). */
public record PaymentRequest(
    @NotNull @Positive Long orderId,
    @NotNull @Positive Integer amount,
    @NotBlank @Size(max = 100) String idempotencyKey) {}
