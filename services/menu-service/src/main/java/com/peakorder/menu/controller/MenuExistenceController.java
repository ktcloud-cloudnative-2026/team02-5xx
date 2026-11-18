package com.peakorder.menu.controller;

import com.peakorder.menu.dto.ApiResponse;
import com.peakorder.menu.dto.MenuExistenceResponse;
import com.peakorder.menu.service.MenuExistenceService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class MenuExistenceController {
  private final MenuExistenceService service;

  public MenuExistenceController(MenuExistenceService service) {
    this.service = service;
  }

  @Operation(
      summary = "MI-02: Check menu existence and status",
      description =
          "Inventory decides whether to allow new links or keep existing links. "
              + "All stored statuses count as existing; missing menus return exists=false and status=null.")
  @ApiResponses({
    @io.swagger.v3.oas.annotations.responses.ApiResponse(
        responseCode = "200",
        description = "Menu existence result"),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(
        responseCode = "400",
        description = "INVALID_REQUEST: invalid menuId",
        content = @Content(schema = @Schema(implementation = ApiResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(
        responseCode = "500",
        description = "INTERNAL_ERROR: database or service failure",
        content = @Content(schema = @Schema(implementation = ApiResponse.class)))
  })
  @GetMapping("/internal/v1/menus/{menuId}/existence")
  public ApiResponse<MenuExistenceResponse> existence(
      @Parameter(description = "Positive Long menu identifier", schema = @Schema(minimum = "1"))
          @PathVariable("menuId")
          Long menuId) {
    return ApiResponse.ok(service.check(menuId));
  }
}
