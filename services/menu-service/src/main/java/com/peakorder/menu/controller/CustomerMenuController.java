package com.peakorder.menu.controller;

import com.peakorder.menu.dto.ApiResponse;
import com.peakorder.menu.dto.CustomerMenuDetailResponse;
import com.peakorder.menu.dto.CustomerMenuListResponse;
import com.peakorder.menu.service.CustomerMenuQueryService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/menus")
public class CustomerMenuController {
  private final CustomerMenuQueryService service;

  public CustomerMenuController(CustomerMenuQueryService service) {
    this.service = service;
  }

  @Operation(
      summary = "ME-01: Public customer menu list",
      description =
          "Returns all categories and visible menus. HIDDEN menus are omitted. "
              + "PAUSED menus remain visible but cannot be purchased. "
              + "Inventory is not consulted. No pagination in this version.")
  @ApiResponses({
    @io.swagger.v3.oas.annotations.responses.ApiResponse(
        responseCode = "200",
        description = "Categories and visible menus"),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(
        responseCode = "400",
        description = "INVALID_REQUEST: categoryId or sort is invalid",
        content = @Content(schema = @Schema(implementation = ApiResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(
        responseCode = "500",
        description = "INTERNAL_ERROR",
        content = @Content(schema = @Schema(implementation = ApiResponse.class)))
  })
  @GetMapping
  public ApiResponse<CustomerMenuListResponse> list(
      @Parameter(description = "Optional positive Long category ID")
          @RequestParam(name = "categoryId", required = false)
          String categoryId,
      @Parameter(description = "Optional case-insensitive menu name substring")
          @RequestParam(name = "query", required = false)
          String query,
      @Parameter(description = "default, priceAsc or priceDesc")
          @RequestParam(name = "sort", required = false)
          String sort) {
    return ApiResponse.ok(service.list(categoryId, query, sort));
  }

  @Operation(
      summary = "ME-02: Public customer menu detail",
      description =
          "ON_SALE and PAUSED menus are readable. HIDDEN and missing menus both return 404. "
              + "Inactive options are included and marked active=false; no stock check.")
  @ApiResponses({
    @io.swagger.v3.oas.annotations.responses.ApiResponse(
        responseCode = "200",
        description = "Menu detail and options"),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(
        responseCode = "400",
        description = "INVALID_REQUEST: menuId is invalid",
        content = @Content(schema = @Schema(implementation = ApiResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(
        responseCode = "404",
        description = "MENU_NOT_FOUND: missing or HIDDEN",
        content = @Content(schema = @Schema(implementation = ApiResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(
        responseCode = "500",
        description = "INTERNAL_ERROR",
        content = @Content(schema = @Schema(implementation = ApiResponse.class)))
  })
  @GetMapping("/{menuId}")
  public ApiResponse<CustomerMenuDetailResponse> detail(
      @Parameter(description = "Positive Long menu ID")
          @PathVariable("menuId")
          String menuId) {
    return ApiResponse.ok(service.detail(menuId));
  }
}
