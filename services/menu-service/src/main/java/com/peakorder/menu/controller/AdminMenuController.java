package com.peakorder.menu.controller;

import com.peakorder.menu.dto.AdminMenuDetail;
import com.peakorder.menu.dto.AdminMenuList;
import com.peakorder.menu.dto.ApiResponse;
import com.peakorder.menu.exception.AdminMenuQueryException;
import com.peakorder.menu.service.AdminMenuAuthorization;
import com.peakorder.menu.service.AdminMenuQueryService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.Parameters;
import io.swagger.v3.oas.annotations.enums.ParameterIn;
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
public class AdminMenuController {
  private final AdminMenuQueryService service;
  private final AdminMenuAuthorization authorization;

  public AdminMenuController(AdminMenuQueryService service, AdminMenuAuthorization authorization) {
    this.service = service;
    this.authorization = authorization;
  }

  @Operation(
      summary = "ME-03: Administrator menu list (currently disabled)",
      description =
          "Default deny: always 403 until reviewed authentication integration. No role headers are trusted. "
              + "Proposed query contract includes ON_SALE, PAUSED and HIDDEN, all categories and no pagination.")
  @Parameters({
    @Parameter(
        name = "categoryId",
        in = ParameterIn.QUERY,
        schema = @Schema(type = "integer", format = "int64", minimum = "1")),
    @Parameter(
        name = "query",
        in = ParameterIn.QUERY,
        description = "Trimmed case-insensitive menu name substring",
        schema = @Schema(type = "string")),
    @Parameter(
        name = "status",
        in = ParameterIn.QUERY,
        schema =
            @Schema(
                type = "string",
                allowableValues = {"ON_SALE", "PAUSED", "HIDDEN"})),
    @Parameter(
        name = "sort",
        in = ParameterIn.QUERY,
        schema =
            @Schema(
                type = "string",
                allowableValues = {"default", "priceAsc", "priceDesc"}))
  })
  @ApiResponses({
    @io.swagger.v3.oas.annotations.responses.ApiResponse(
        responseCode = "200",
        description =
            "Proposed administrator menu list; unavailable with the production deny boundary"),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(
        responseCode = "400",
        description = "INVALID_REQUEST (after authorization)",
        content = @Content(schema = @Schema(implementation = ApiResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(
        responseCode = "401",
        description = "UNAUTHORIZED (simulated mapping; authentication not connected)",
        content = @Content(schema = @Schema(implementation = ApiResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(
        responseCode = "403",
        description = "FORBIDDEN (all production requests are denied)",
        content = @Content(schema = @Schema(implementation = ApiResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(
        responseCode = "500",
        description = "INTERNAL_ERROR",
        content = @Content(schema = @Schema(implementation = ApiResponse.class)))
  })
  @GetMapping(value = "/api/v1/admin/menus", produces = "application/json")
  public ApiResponse<AdminMenuList> list(
      @Parameter(hidden = true) @RequestParam MultiValueMap<String, String> parameters) {
    authorization.requireStoreAdmin();
    for (String name : List.of("categoryId", "query", "status", "sort")) {
      if (parameters.containsKey(name) && parameters.get(name).size() != 1) {
        throw AdminMenuQueryException.invalidRequest();
      }
    }
    Long categoryId =
        parameters.containsKey("categoryId") ? positiveId(parameters.getFirst("categoryId")) : null;
    return ApiResponse.ok(
        service.list(
            categoryId,
            parameters.getFirst("query"),
            parameters.getFirst("status"),
            parameters.getFirst("sort")));
  }

  @Operation(
      summary = "ME-04: Administrator menu detail (currently disabled)",
      description =
          "Default deny: always 403 until reviewed authentication integration. "
              + "Proposed detail allows HIDDEN and includes inactive options in ID order.")
  @ApiResponses({
    @io.swagger.v3.oas.annotations.responses.ApiResponse(
        responseCode = "200",
        description =
            "Proposed administrator detail; unavailable with the production deny boundary"),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(
        responseCode = "400",
        description = "INVALID_REQUEST (after authorization)",
        content = @Content(schema = @Schema(implementation = ApiResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(
        responseCode = "401",
        description = "UNAUTHORIZED (simulated mapping; authentication not connected)",
        content = @Content(schema = @Schema(implementation = ApiResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(
        responseCode = "403",
        description = "FORBIDDEN (all production requests are denied)",
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
  @GetMapping(value = "/api/v1/admin/menus/{menuId}", produces = "application/json")
  public ApiResponse<AdminMenuDetail> detail(
      @Parameter(schema = @Schema(type = "integer", format = "int64", minimum = "1"))
          @PathVariable("menuId")
          String menuId) {
    authorization.requireStoreAdmin();
    return ApiResponse.ok(service.detail(positiveId(menuId)));
  }

  private Long positiveId(String value) {
    try {
      long id = Long.parseLong(value);
      if (id > 0) {
        return id;
      }
    } catch (NumberFormatException exception) {
      // Fixed client error; do not echo arbitrary input into the response.
    }
    throw AdminMenuQueryException.invalidRequest();
  }
}
