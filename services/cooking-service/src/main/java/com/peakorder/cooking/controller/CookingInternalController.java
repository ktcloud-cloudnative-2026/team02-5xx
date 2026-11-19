package com.peakorder.cooking.controller;

import com.peakorder.cooking.dto.ApiResponse;
import com.peakorder.cooking.dto.CookingStatusResponse;
import com.peakorder.cooking.service.CookingQueryService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 내부 API (호출자: Order) */
@RestController
@RequestMapping("/internal/v1/cooking")
public class CookingInternalController {

  private final CookingQueryService queryService;

  public CookingInternalController(CookingQueryService queryService) {
    this.queryService = queryService;
  }

  /** CI-02 주문별 조리 상태·예상시간 조회 */
  @GetMapping("/orders/{orderId}")
  public ApiResponse<CookingStatusResponse> getStatus(@PathVariable Long orderId) {
    return ApiResponse.ok(queryService.getStatus(orderId));
  }
}
