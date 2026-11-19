package com.peakorder.inventory.controller;

import com.peakorder.inventory.dto.ApiResponse;
import com.peakorder.inventory.dto.MenuLinkRequest;
import com.peakorder.inventory.dto.StockItemCreateRequest;
import com.peakorder.inventory.dto.StockItemResponse;
import com.peakorder.inventory.dto.StockRestockRequest;
import com.peakorder.inventory.service.InventoryAdminService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** 관리자 재고 API. TODO(인증): JWT 공통 계약(#112)이 확정되면 STORE_ADMIN 권한 검사를 추가한다. */
@RestController
@RequestMapping("/api/v1/admin/inventory/items")
public class InventoryAdminController {

  private final InventoryAdminService adminService;

  public InventoryAdminController(InventoryAdminService adminService) {
    this.adminService = adminService;
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
}
