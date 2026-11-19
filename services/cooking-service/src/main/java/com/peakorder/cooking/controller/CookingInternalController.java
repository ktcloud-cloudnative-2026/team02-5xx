package com.peakorder.cooking.controller;

import com.peakorder.cooking.dto.ApiResponse;
import com.peakorder.cooking.dto.CookingCancelResponse;
import com.peakorder.cooking.dto.CookingStatusResponse;
import com.peakorder.cooking.service.CookingCancelService;
import com.peakorder.cooking.service.CookingQueryService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 내부 API (호출자: Order) */
@RestController
@RequestMapping("/internal/v1/cooking")
public class CookingInternalController {

  private final CookingQueryService queryService;
  private final CookingCancelService cancelService;

  public CookingInternalController(
      CookingQueryService queryService, CookingCancelService cancelService) {
    this.queryService = queryService;
    this.cancelService = cancelService;
  }

  /** CI-02 주문별 조리 상태·예상시간 조회 */
  @GetMapping("/orders/{orderId}")
  public ApiResponse<CookingStatusResponse> getStatus(@PathVariable Long orderId) {
    return ApiResponse.ok(queryService.getStatus(orderId));
  }

  /** CI-03 취소 가능 여부 확인 및 대기열에서 제거 (본문 없음, 멱등) */
  @PostMapping("/orders/{orderId}/cancel")
  public ApiResponse<CookingCancelResponse> cancel(@PathVariable Long orderId) {
    return ApiResponse.ok(cancelService.cancel(orderId));
  }
}
