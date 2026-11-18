package com.peakorder.cooking.controller;

import com.peakorder.cooking.dto.ApiResponse;
import com.peakorder.cooking.dto.CookingQueueResponse;
import com.peakorder.cooking.service.CookingQueryService;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 관리자 API (권한: STORE_ADMIN).
 *
 * <p>TODO: 권한 검사 미적용. JWT 검증 위치(Gateway 또는 서비스)가 정해지면 STORE_ADMIN 확인을 추가한다.
 *
 * <p>인증 연동 전까지 노출 방지: `cooking.admin.enabled=true`(환경 변수 COOKING_ADMIN_ENABLED)일 때만 등록된다. 기본값은
 * 꺼짐이며, 꺼져 있으면 관리자 경로는 404로 응답한다. 로컬·dev에서만 켜고 prod는 권한 검사 적용 전까지 끈다(PR #53 리뷰).
 */
@RestController
@RequestMapping("/api/v1/admin/cooking")
@ConditionalOnProperty(name = "cooking.admin.enabled", havingValue = "true")
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
