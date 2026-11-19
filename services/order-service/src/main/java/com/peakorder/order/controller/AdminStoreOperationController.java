package com.peakorder.order.controller;

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
 * <p>TODO(인증): 관리자 권한(STORE_ADMIN) 검사 방식은 Auth·Gateway·JWT 공통 계약(#112)에서 정해진다. 그 전에는 누구나 영업을 열고 닫을
 * 수 있으므로 설정 {@code order.admin.enabled}(기본 false)가 켜진 로컬·dev에서만 이 컨트롤러를 등록한다. 꺼져 있으면 경로가 존재하지 않는
 * 것처럼 404다. Cooking 관리자 API와 같은 방식이다.
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
  public ApiResponse<StoreOperationResponse> get() {
    return ApiResponse.ok(storeOperationService.get());
  }

  @PatchMapping
  @Operation(summary = "영업·주문 접수 상태 변경 (OR-07, 보낸 항목만 변경)")
  public ApiResponse<StoreOperationResponse> update(
      @RequestBody UpdateStoreOperationRequest request) {
    return ApiResponse.ok(storeOperationService.update(request), "영업·접수 상태가 변경되었습니다.");
  }
}
