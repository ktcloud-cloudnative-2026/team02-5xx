package com.peakorder.menu.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.peakorder.menu.entity.MenuStatus;
import io.swagger.v3.oas.annotations.media.Schema;

@JsonInclude(JsonInclude.Include.ALWAYS)
public record MenuExistenceResponse(
    @Schema(minimum = "1", requiredMode = Schema.RequiredMode.REQUIRED) Long menuId,
    @Schema(description = "Whether the menu record exists, regardless of sales status")
        boolean exists,
    @Schema(
            description = "Stored menu status; null when the menu does not exist",
            nullable = true,
            requiredMode = Schema.RequiredMode.REQUIRED)
        MenuStatus status) {}
