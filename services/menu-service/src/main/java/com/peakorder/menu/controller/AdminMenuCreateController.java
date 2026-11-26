package com.peakorder.menu.controller;

import com.peakorder.menu.dto.AdminMenuCreateRequest;
import com.peakorder.menu.dto.AdminMenuCreated;
import com.peakorder.menu.dto.ApiResponse;
import com.peakorder.menu.exception.MenuCreateException;
import com.peakorder.menu.service.AdminMenuAuthorization;
import com.peakorder.menu.service.AdminMenuCreateService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.core.JacksonException;
import tools.jackson.core.StreamReadFeature;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

@RestController
public class AdminMenuCreateController {
  private final AdminMenuCreateService service;
  private final AdminMenuAuthorization authorization;
  private final ObjectMapper mapper;

  public AdminMenuCreateController(
      AdminMenuCreateService service, AdminMenuAuthorization authorization, ObjectMapper mapper) {
    this.service = service;
    this.authorization = authorization;
    this.mapper = mapper;
  }

  @Operation(
      summary = "ME-05: Create menu (disabled by default)",
      description =
          "Disabled by default (MENU_ADMIN_ENABLED=false). When enabled behind the Gateway, canonical identity headers and STORE_ADMIN are required.",
      requestBody =
          @io.swagger.v3.oas.annotations.parameters.RequestBody(
              required = true,
              content = @Content(schema = @Schema(implementation = AdminMenuCreateRequest.class))))
  @ApiResponses({
    @io.swagger.v3.oas.annotations.responses.ApiResponse(
        responseCode = "201",
        description = "Created menu ID (after verified authorization)"),
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
        description = "CATEGORY_NOT_FOUND",
        content = @Content(schema = @Schema(implementation = ApiResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(
        responseCode = "500",
        description = "INTERNAL_ERROR",
        content = @Content(schema = @Schema(implementation = ApiResponse.class)))
  })
  @PostMapping(
      value = "/api/v1/admin/menus",
      consumes = "application/json",
      produces = "application/json")
  @ResponseStatus(HttpStatus.CREATED)
  public ApiResponse<AdminMenuCreated> create(@Parameter(hidden = true) HttpServletRequest request)
      throws IOException {
    authorization.requireStoreAdmin();
    // Read only after authorization; malformed bodies cannot bypass the denial boundary.
    JsonNode json;
    try {
      json =
          mapper
              .readerFor(JsonNode.class)
              .with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
              .with(StreamReadFeature.STRICT_DUPLICATE_DETECTION)
              .readValue(request.getInputStream());
    } catch (JacksonException exception) {
      throw MenuCreateException.invalid();
    }
    return ApiResponse.ok(service.create(AdminMenuCreateRequest.fromJson(json)));
  }
}
