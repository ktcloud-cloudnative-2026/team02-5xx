package com.peakorder.order.controller;

import com.peakorder.order.config.CurrentUser;
import com.peakorder.order.config.UserRole;
import com.peakorder.order.dto.AdminOrderDetailResponse;
import com.peakorder.order.dto.AdminOrderListResponse;
import com.peakorder.order.dto.ApiResponse;
import com.peakorder.order.service.AdminOrderService;
import io.swagger.v3.oas.annotations.Operation;
import java.time.LocalDate;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 관리자 주문 조회 API(OR-08·OR-09, 권한 STORE_ADMIN).
 *
 * <p>권한 확인: Gateway가 전달한 {@code X-User-Id}·{@code X-User-Role}이 유효하고 역할이 STORE_ADMIN이어야 한다. 헤더가 없거나
 * 형식이 틀리면 401 UNAUTHORIZED, STORE_ADMIN이 아니면 403 FORBIDDEN이다(#112, #263). 다만 이 헤더는 Gateway의 JWT 검증이
 * dev에서 확인되기 전에는 믿을 수 없고 이 API는 전체 사용자의 주문(결제·취소 정보 포함)을 보여 주므로, 설정 {@code order.admin.enabled}(기본
 * false)가 켜진 격리된 로컬 환경에서만 이 컨트롤러를 등록한다. 꺼져 있으면 경로가 존재하지 않는 것처럼 404다. 영업·접수 API(OR-06·07)와 같은 방식이다.
 */
@RestController
@RequestMapping("/api/v1/admin/orders")
@ConditionalOnProperty(name = "order.admin.enabled", havingValue = "true")
public class AdminOrderController {

  private final AdminOrderService adminOrderService;

  public AdminOrderController(AdminOrderService adminOrderService) {
    this.adminOrderService = adminOrderService;
  }

  @GetMapping
  @Operation(summary = "관리자 주문 목록·검색 (OR-08)")
  public ApiResponse<AdminOrderListResponse> search(
      @CurrentUser(UserRole.STORE_ADMIN) Long adminId,
      @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
      @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
      @RequestParam(required = false) String orderNo,
      @RequestParam(required = false) String status,
      @RequestParam(required = false) Boolean manualReviewRequired,
      @RequestParam(defaultValue = "0") int page,
      @RequestParam(defaultValue = "20") int size) {
    return ApiResponse.ok(
        adminOrderService.search(from, to, orderNo, status, manualReviewRequired, page, size));
  }

  @GetMapping("/{orderId}")
  @Operation(summary = "관리자 주문 상세 조회 (OR-09)")
  public ApiResponse<AdminOrderDetailResponse> get(
      @CurrentUser(UserRole.STORE_ADMIN) Long adminId, @PathVariable Long orderId) {
    return ApiResponse.ok(adminOrderService.get(orderId));
  }
}
