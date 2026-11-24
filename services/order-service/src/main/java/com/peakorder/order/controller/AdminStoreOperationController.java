package com.peakorder.order.controller;

import com.peakorder.order.config.CurrentUser;
import com.peakorder.order.config.UserRole;
import com.peakorder.order.dto.ApiResponse;
import com.peakorder.order.dto.StoreOperationResponse;
import com.peakorder.order.dto.UpdateStoreOperationRequest;
import com.peakorder.order.service.StoreOperationService;
import io.swagger.v3.oas.annotations.Operation;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 관리자 영업·주문 접수 상태 API(OR-06·OR-07, 권한 STORE_ADMIN).
 *
 * <p>권한 확인: Gateway가 전달한 {@code X-User-Id}·{@code X-User-Role}이 유효하고 역할이 STORE_ADMIN이어야 한다. 헤더가 없거나
 * 형식이 틀리면 401 UNAUTHORIZED, STORE_ADMIN이 아니면 403 FORBIDDEN이다(#112, #263). 다만 이 헤더는 Gateway의 JWT 검증이
 * dev에서 확인되기 전에는 믿을 수 없으므로, 설정 {@code order.admin.enabled}(기본 false)가 켜진 격리된 로컬 환경에서만 이 컨트롤러를 등록한다.
 * 꺼져 있으면 경로가 존재하지 않는 것처럼 404다. Cooking 관리자 API와 같은 방식이다.
 */
@RestController
@RequestMapping("/api/v1/admin/store/operations")
@ConditionalOnProperty(name = "order.admin.enabled", havingValue = "true")
public class AdminStoreOperationController {

  private final StoreOperationService storeOperationService;

  public AdminStoreOperationController(StoreOperationService storeOperationService) {
    this.storeOperationService = storeOperationService;
  }

  @GetMapping
  @Operation(summary = "영업·주문 접수 상태 조회 (OR-06)")
  public ApiResponse<StoreOperationResponse> get(@CurrentUser(UserRole.STORE_ADMIN) Long adminId) {
    return ApiResponse.ok(storeOperationService.get());
  }

  @PatchMapping
  @Operation(summary = "영업·주문 접수 상태 변경 (OR-07, 보낸 항목만 변경)")
  public ApiResponse<StoreOperationResponse> update(
      @CurrentUser(UserRole.STORE_ADMIN) Long adminId,
      @RequestBody UpdateStoreOperationRequest request) {
    return ApiResponse.ok(storeOperationService.update(request), "영업·접수 상태가 변경되었습니다.");
  }
}
