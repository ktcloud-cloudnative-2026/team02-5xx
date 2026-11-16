package com.peakorder.cooking.controller;

import com.peakorder.cooking.dto.ApiResponse;
import com.peakorder.cooking.dto.CookingQueueResponse;
import com.peakorder.cooking.service.CookingQueryService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 관리자 API (권한: STORE_ADMIN).
 *
 * <p>TODO: 권한 검사 미적용. JWT 검증 위치(Gateway 또는 서비스)가 정해지면 STORE_ADMIN 확인을 추가한다.
 */
@RestController
@RequestMapping("/api/v1/admin/cooking")
public class CookingAdminController {

  private final CookingQueryService queryService;

  public CookingAdminController(CookingQueryService queryService) {
    this.queryService = queryService;
  }

  /** CO-04 FIFO 대기열 조회 */
  @GetMapping("/queue")
  public ApiResponse<CookingQueueResponse> getQueue() {
    return ApiResponse.ok(queryService.getQueue());
  }
}
