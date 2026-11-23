package com.peakorder.auth.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record PasswordChangeRequest(
    @NotBlank @Size(max = 1024) @Schema(accessMode = Schema.AccessMode.WRITE_ONLY)
        String currentPassword,
    @NotBlank @Size(max = 1024) @Schema(accessMode = Schema.AccessMode.WRITE_ONLY)
        String newPassword) {
  @Override
  public String toString() {
    return "PasswordChangeRequest[redacted]";
  }
}
