package com.peakorder.inventory.controller;

import com.peakorder.inventory.dto.ApiResponse;
import com.peakorder.inventory.dto.HoldRequest;
import com.peakorder.inventory.dto.HoldResponse;
import com.peakorder.inventory.service.InventoryHoldService;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/internal/v1/inventory")
public class InternalInventoryController {

  private final InventoryHoldService holdService;

  public InternalInventoryController(InventoryHoldService holdService) {
    this.holdService = holdService;
  }

  @PostMapping("/holds")
  public ApiResponse<HoldResponse> hold(@Valid @RequestBody HoldRequest request) {
    return ApiResponse.ok(holdService.hold(request));
  }

  @PostMapping("/holds/{holdId}/confirm")
  public ApiResponse<Void> confirm(@PathVariable Long holdId) {
    holdService.confirm(holdId);
    return ApiResponse.ok(null);
  }
}
