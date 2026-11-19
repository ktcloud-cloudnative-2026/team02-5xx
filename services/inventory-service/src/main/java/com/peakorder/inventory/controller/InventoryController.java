package com.peakorder.inventory.controller;

import com.peakorder.inventory.dto.ApiResponse;
import com.peakorder.inventory.dto.AvailabilityResponse;
import com.peakorder.inventory.service.InventoryQueryService;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 고객용 재고 API. */
@RestController
@RequestMapping("/api/v1/inventory")
public class InventoryController {

  private final InventoryQueryService queryService;

  public InventoryController(InventoryQueryService queryService) {
    this.queryService = queryService;
  }

  @GetMapping("/availability")
  public ApiResponse<List<AvailabilityResponse>> availability(
      @RequestParam(required = false) String menuIds) {
    return ApiResponse.ok(queryService.availability(menuIds));
  }
}
