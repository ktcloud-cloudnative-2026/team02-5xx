package com.peakorder.auth.config;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Pattern;
import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;
import org.springframework.validation.annotation.Validated;

@Validated
@ConfigurationProperties("auth.session")
public record SessionProperties(
    @NotBlank String issuer,
    @NotBlank String audience,
    @NotBlank @Pattern(regexp = "[A-Za-z0-9_-]{1,64}") String keyId,
    @NotBlank String privateKeyFile,
    @NotBlank String publicKeyFile,
    @NotEmpty List<String> allowedOrigins,
    @DefaultValue("peakorderRefreshToken") @Pattern(regexp = "[A-Za-z][A-Za-z0-9_-]{0,63}")
        String cookieName) {
  public SessionProperties {
    allowedOrigins = allowedOrigins == null ? List.of() : List.copyOf(allowedOrigins);
  }
}
