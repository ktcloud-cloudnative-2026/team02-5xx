package com.peakorder.cooking.controller;

import com.peakorder.cooking.dto.ApiResponse;
import com.peakorder.cooking.dto.CongestionResponse;
import com.peakorder.cooking.service.CookingDashboardService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 외부 API (권한: 전체) */
@RestController
@RequestMapping("/api/v1/cooking")
public class CookingController {

  private final CookingDashboardService dashboardService;

  public CookingController(CookingDashboardService dashboardService) {
    this.dashboardService = dashboardService;
  }

  /** CO-01 현재 혼잡도, 대기 주문 수, 예상 대기시간 */
  @GetMapping("/congestion")
  public ApiResponse<CongestionResponse> getCongestion() {
    return ApiResponse.ok(dashboardService.getCongestion());
  }
}
