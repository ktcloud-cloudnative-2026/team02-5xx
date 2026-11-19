package com.peakorder.menu.controller;

import com.peakorder.menu.dto.ApiResponse;
import com.peakorder.menu.dto.CustomerMenuDetail;
import com.peakorder.menu.dto.CustomerMenuList;
import com.peakorder.menu.exception.CustomerMenuException;
import com.peakorder.menu.service.CustomerMenuService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import java.util.List;
import org.springframework.util.MultiValueMap;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class CustomerMenuController {
  private final CustomerMenuService service;

  public CustomerMenuController(CustomerMenuService service) {
    this.service = service;
  }

  @Operation(
      summary = "ME-01: Public menu list and categories",
      description =
          "Includes ON_SALE and PAUSED; excludes HIDDEN. Does not check stock. No pagination.")
  @ApiResponses({
    @io.swagger.v3.oas.annotations.responses.ApiResponse(
        responseCode = "200",
        description = "Categories and menus"),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(
        responseCode = "400",
        description = "INVALID_REQUEST",
        content = @Content(schema = @Schema(implementation = ApiResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(
        responseCode = "500",
        description = "INTERNAL_ERROR",
        content = @Content(schema = @Schema(implementation = ApiResponse.class)))
  })
  @GetMapping(value = "/api/v1/menus", produces = "application/json")
  public ApiResponse<CustomerMenuList> list(
      @Parameter(schema = @Schema(minimum = "1"))
          @RequestParam(name = "categoryId", required = false)
          Long categoryId,
      @Parameter(
              description = "Case-insensitive name substring; leading/trailing whitespace removed")
          @RequestParam(name = "query", required = false)
          String query,
      @Parameter(schema = @Schema(allowableValues = {"default", "priceAsc", "priceDesc"}))
          @RequestParam(name = "sort", required = false)
          String sort,
      @Parameter(hidden = true) @RequestParam MultiValueMap<String, String> parameters) {
    for (String name : List.of("categoryId", "query", "sort")) {
      if (parameters.containsKey(name) && parameters.get(name).size() != 1) {
        throw CustomerMenuException.invalidRequest();
      }
    }
    if (parameters.containsKey("categoryId") && categoryId == null) {
      throw CustomerMenuException.invalidRequest();
    }
    return ApiResponse.ok(service.list(categoryId, query, sort));
  }

  @Operation(
      summary = "ME-02: Public menu detail",
      description =
          "PAUSED is readable. HIDDEN and missing menus both return 404. Includes inactive options in ID order.")
  @ApiResponses({
    @io.swagger.v3.oas.annotations.responses.ApiResponse(
        responseCode = "200",
        description = "Menu detail"),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(
        responseCode = "400",
        description = "INVALID_REQUEST",
        content = @Content(schema = @Schema(implementation = ApiResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(
        responseCode = "404",
        description = "MENU_NOT_FOUND",
        content = @Content(schema = @Schema(implementation = ApiResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(
        responseCode = "500",
        description = "INTERNAL_ERROR",
        content = @Content(schema = @Schema(implementation = ApiResponse.class)))
  })
  @GetMapping(value = "/api/v1/menus/{menuId}", produces = "application/json")
  public ApiResponse<CustomerMenuDetail> detail(
      @Parameter(schema = @Schema(minimum = "1")) @PathVariable("menuId") Long menuId) {
    return ApiResponse.ok(service.detail(menuId));
  }
}
