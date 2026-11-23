package com.peakorder.auth.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import org.hibernate.validator.constraints.CodePointLength;

public record ProfileUpdateRequest(
    @NotBlank @CodePointLength(min = 1, max = 50) @Schema(minLength = 1, maxLength = 50)
        String nickname) {
  @Override
  public String toString() {
    return "ProfileUpdateRequest[redacted]";
  }
}
