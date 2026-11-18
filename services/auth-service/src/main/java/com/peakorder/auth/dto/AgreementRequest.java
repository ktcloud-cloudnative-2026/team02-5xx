package com.peakorder.auth.dto;

import com.peakorder.auth.entity.AgreementType;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

public record AgreementRequest(
    @NotNull AgreementType type,
    @NotBlank @Size(max = 64) String version,
    @NotNull Boolean agreed) {}
