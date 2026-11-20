package com.peakorder.order.dto;

import java.util.List;

public record AdminOrderListResponse(
    List<AdminOrderSummaryResponse> items, int page, int size, long totalElements) {}
