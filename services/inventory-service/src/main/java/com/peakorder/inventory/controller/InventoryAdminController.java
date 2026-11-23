package com.peakorder.inventory.controller;

import com.peakorder.inventory.dto.ApiResponse;
import com.peakorder.inventory.dto.MenuLinkRequest;
import com.peakorder.inventory.dto.StockItemCreateRequest;
import com.peakorder.inventory.dto.StockItemResponse;
import com.peakorder.inventory.dto.StockRestockRequest;
import com.peakorder.inventory.service.InventoryAdminService;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * 관리자 재고 API (권한: STORE_ADMIN).
 *
 * <p>인증 연동 전까지 노출 방지: `inventory.admin.enabled=true`(환경 변수 INVENTORY_ADMIN_ENABLED)일 때만 등록된다. 기본값은
 * 꺼짐이며, 꺼져 있으면 관리자 경로는 404로 응답한다. 격리된 로컬에서만 켜고, 공유 dev·prod는 JWT/STORE_ADMIN 인가(#112)와 Gateway 격리를
 * 확인하기 전까지 끈다(PR #143 리뷰).
 */
@RestController
@RequestMapping("/api/v1/admin/inventory/items")
@ConditionalOnProperty(name = "inventory.admin.enabled", havingValue = "true")
public class InventoryAdminController {

  private final InventoryAdminService adminService;

  public InventoryAdminController(InventoryAdminService adminService) {
    this.adminService = adminService;
  }

  @GetMapping
  public ApiResponse<List<StockItemResponse>> list(
      @RequestParam(defaultValue = "false") boolean lowStockOnly) {
    return ApiResponse.ok(adminService.list(lowStockOnly));
  }

  @PostMapping
  @ResponseStatus(HttpStatus.CREATED)
  public ApiResponse<StockItemResponse> create(@Valid @RequestBody StockItemCreateRequest request) {
    return ApiResponse.ok(adminService.create(request));
  }

  @PostMapping("/{stockItemId}/adjustments")
  public ApiResponse<StockItemResponse> restock(
      @PathVariable Long stockItemId, @Valid @RequestBody StockRestockRequest request) {
    return ApiResponse.ok(adminService.restock(stockItemId, request));
  }

  @PutMapping("/{stockItemId}/menu-link")
  public ApiResponse<StockItemResponse> linkMenu(
      @PathVariable Long stockItemId, @Valid @RequestBody MenuLinkRequest request) {
    return ApiResponse.ok(adminService.linkMenu(stockItemId, request));
  }

  @DeleteMapping("/{stockItemId}")
  public ApiResponse<StockItemResponse> delete(@PathVariable Long stockItemId) {
    return ApiResponse.ok(adminService.delete(stockItemId));
  }
}
