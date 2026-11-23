package com.peakorder.auth.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import tools.jackson.databind.annotation.JsonDeserialize;

public record LoginRequest(
    // Bound raw input; EmailAddress validates the 254-character limit after stripping whitespace.
    @NotBlank @Size(max = 1024) String email,
    @NotBlank @Size(max = 1024) @Schema(accessMode = Schema.AccessMode.WRITE_ONLY) String password,
    @JsonDeserialize(using = StrictBooleanDeserializer.class) Boolean rememberMe) {
  @Override
  public String toString() {
    return "LoginRequest[redacted]";
  }
}
