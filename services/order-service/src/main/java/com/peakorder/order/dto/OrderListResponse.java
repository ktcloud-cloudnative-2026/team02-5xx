package com.peakorder.order.dto;

import java.util.List;

public record OrderListResponse(
    List<OrderSummaryResponse> items, int page, int size, long totalElements) {}
