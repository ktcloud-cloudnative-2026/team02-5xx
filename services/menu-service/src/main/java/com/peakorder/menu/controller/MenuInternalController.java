package com.peakorder.menu.controller;

import com.peakorder.menu.dto.ApiResponse;
import com.peakorder.menu.dto.ValidatePurchaseRequest;
import com.peakorder.menu.dto.ValidatePurchaseResponse;
import com.peakorder.menu.service.PurchaseValidationService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/internal/v1/menus")
public class MenuInternalController {
  private final PurchaseValidationService service;

  public MenuInternalController(PurchaseValidationService service) {
    this.service = service;
  }

  @Operation(
      summary = "MI-01 purchase validation",
      description =
          "Used by Order and Cooking. Returns per-unit prices and cooking times in request order. "
              + "Only ON_SALE menus and active options are allowed. Inventory is not checked.")
  @ApiResponses({
    @io.swagger.v3.oas.annotations.responses.ApiResponse(
        responseCode = "200",
        description = "All items validated"),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(
        responseCode = "400",
        description = "Invalid request or unavailable purchase: INVALID_REQUEST",
        content =
            @Content(
                mediaType = "application/json",
                schema = @Schema(implementation = ApiResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(
        responseCode = "500",
        description = "Invalid stored data or internal failure: INTERNAL_ERROR",
        content =
            @Content(
                mediaType = "application/json",
                schema = @Schema(implementation = ApiResponse.class)))
  })
  @PostMapping("/validate-purchase")
  public ApiResponse<ValidatePurchaseResponse> validate(
      @RequestBody ValidatePurchaseRequest request) {
    return ApiResponse.ok(service.validate(request));
  }
}
