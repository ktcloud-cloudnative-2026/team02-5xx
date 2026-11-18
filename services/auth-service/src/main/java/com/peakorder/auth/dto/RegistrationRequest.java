package com.peakorder.auth.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;

public record RegistrationRequest(
    @NotBlank String email,
    @NotNull @Schema(accessMode = Schema.AccessMode.WRITE_ONLY) String password,
    @NotEmpty @Size(max = 2) List<@NotNull @Valid AgreementRequest> agreements) {

  @Override
  public String toString() {
    return "RegistrationRequest[redacted]";
  }
}
