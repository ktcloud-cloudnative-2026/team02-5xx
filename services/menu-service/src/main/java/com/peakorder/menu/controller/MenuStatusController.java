package com.peakorder.menu.controller;

import com.peakorder.menu.dto.ApiResponse;
import com.peakorder.menu.dto.MenuStatusChanged;
import com.peakorder.menu.dto.MenuStatusRequest;
import com.peakorder.menu.exception.MenuStatusChangeException;
import com.peakorder.menu.service.AdminMenuAuthorization;
import com.peakorder.menu.service.MenuStatusService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.core.JacksonException;
import tools.jackson.core.StreamReadFeature;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

@RestController
public class MenuStatusController {
  private final MenuStatusService service;
  private final AdminMenuAuthorization authorization;
  private final ObjectMapper mapper;

  public MenuStatusController(
      MenuStatusService service, AdminMenuAuthorization authorization, ObjectMapper mapper) {
    this.service = service;
    this.authorization = authorization;
    this.mapper = mapper;
  }

  @Operation(
      summary = "ME-07: Change menu status (disabled by default)",
      description =
          "Disabled by default (MENU_ADMIN_ENABLED=false); enabled access requires canonical identity headers and STORE_ADMIN. Proposed contract allows every transition including HIDDEN recovery. Same-state requests succeed without timestamp change. Inventory is not checked.",
      requestBody =
          @io.swagger.v3.oas.annotations.parameters.RequestBody(
              required = true,
              content = @Content(schema = @Schema(implementation = MenuStatusRequest.class))))
  @ApiResponses({
    @io.swagger.v3.oas.annotations.responses.ApiResponse(
        responseCode = "200",
        description = "Menu ID and requested status, only after verified authorization"),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(
        responseCode = "400",
        description = "INVALID_REQUEST",
        content = @Content(schema = @Schema(implementation = ApiResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(
        responseCode = "401",
        description = "UNAUTHORIZED: missing/malformed identity after verified ingress",
        content = @Content(schema = @Schema(implementation = ApiResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(
        responseCode = "403",
        description = "FORBIDDEN: disabled or insufficient role",
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
  @PatchMapping(
      value = "/api/v1/admin/menus/{menuId}/status",
      consumes = "application/json",
      produces = "application/json")
  public ApiResponse<MenuStatusChanged> change(
      @Parameter(schema = @Schema(type = "integer", format = "int64", minimum = "1"))
          @PathVariable("menuId")
          String menuId,
      @Parameter(hidden = true) HttpServletRequest request)
      throws IOException {
    authorization.requireStoreAdmin();
    long id;
    try {
      id = Long.parseLong(menuId);
      if (id <= 0) throw MenuStatusChangeException.invalid();
    } catch (NumberFormatException e) {
      throw MenuStatusChangeException.invalid();
    }
    JsonNode json;
    try {
      json =
          mapper
              .readerFor(JsonNode.class)
              .with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
              .with(StreamReadFeature.STRICT_DUPLICATE_DETECTION)
              .readValue(request.getInputStream());
    } catch (JacksonException e) {
      throw MenuStatusChangeException.invalid();
    }
    return ApiResponse.ok(service.change(id, MenuStatusRequest.parse(json)));
  }
}
