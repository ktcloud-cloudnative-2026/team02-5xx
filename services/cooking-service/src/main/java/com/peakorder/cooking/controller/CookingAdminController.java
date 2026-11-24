package com.peakorder.cooking.controller;

import com.peakorder.cooking.config.CurrentUser;
import com.peakorder.cooking.config.UserRole;
import com.peakorder.cooking.dto.ApiResponse;
import com.peakorder.cooking.dto.CookingOverviewResponse;
import com.peakorder.cooking.dto.CookingQueueResponse;
import com.peakorder.cooking.service.CookingDashboardService;
import com.peakorder.cooking.service.CookingQueryService;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 관리자 API (권한: STORE_ADMIN).
 *
 * <p>권한 확인: Gateway가 전달한 {@code X-User-Id}·{@code X-User-Role}이 유효하고 역할이 STORE_ADMIN이어야 한다. 헤더가 없거나
 * 형식이 틀리면 401 UNAUTHORIZED, STORE_ADMIN이 아니면 403 FORBIDDEN이다(#112, #99 — Order #265와 같은 규칙).
 *
 * <p>노출 방지 토글 유지: 이 헤더는 Gateway의 JWT 검증이 dev에서 확인되기 전에는 믿을 수 없으므로, `cooking.admin.enabled=true`(환경
 * 변수 COOKING_ADMIN_ENABLED)일 때만 등록된다. 기본값은 꺼짐이며, 꺼져 있으면 관리자 경로는 404로 응답한다. Gateway JWT 검증 확인 후 켜는
 * 것을 결정한다(#112 Cooking 수용 댓글). {@code /api/v1/admin/**}은 그 전까지 HTTPRoute에 넣지 않는다(#266).
 */
@RestController
@RequestMapping("/api/v1/admin/cooking")
@ConditionalOnProperty(name = "cooking.admin.enabled", havingValue = "true")
public class CookingAdminController {

  private final CookingQueryService queryService;
  private final CookingDashboardService dashboardService;

  public CookingAdminController(
      CookingQueryService queryService, CookingDashboardService dashboardService) {
    this.queryService = queryService;
    this.dashboardService = dashboardService;
  }

  /** CO-03 대기·조리 중·완료 건수 등 현황 조회 */
  @GetMapping("/overview")
  public ApiResponse<CookingOverviewResponse> getOverview(
      @CurrentUser(UserRole.STORE_ADMIN) Long adminId) {
    return ApiResponse.ok(dashboardService.getOverview());
  }

  /** CO-04 FIFO 대기열 조회 */
  @GetMapping("/queue")
  public ApiResponse<CookingQueueResponse> getQueue(
      @CurrentUser(UserRole.STORE_ADMIN) Long adminId) {
    return ApiResponse.ok(queryService.getQueue());
  }
}
