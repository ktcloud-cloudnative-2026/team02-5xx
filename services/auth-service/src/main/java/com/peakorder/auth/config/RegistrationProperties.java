package com.peakorder.auth.config;

import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

@Validated
@ConfigurationProperties("auth.registration")
public record RegistrationProperties(
    @Min(1) @Max(1024) int passwordMinLength,
    @Min(1) @Max(1024) int passwordMaxLength,
    @NotNull @Size(max = 64) String termsVersion,
    @NotNull @Size(max = 64) String privacyVersion) {

  @AssertTrue(message = "passwordMinLength must not exceed passwordMaxLength")
  public boolean isPasswordRangeValid() {
    return passwordMinLength <= passwordMaxLength;
  }
}
