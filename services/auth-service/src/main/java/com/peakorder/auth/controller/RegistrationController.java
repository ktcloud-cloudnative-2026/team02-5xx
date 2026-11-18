package com.peakorder.auth.controller;

import com.peakorder.auth.dto.ApiResponse;
import com.peakorder.auth.dto.EmailAvailabilityResponse;
import com.peakorder.auth.dto.RegistrationRequest;
import com.peakorder.auth.dto.RegistrationResponse;
import com.peakorder.auth.service.RegistrationService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping(value = "/api/v1/auth", produces = MediaType.APPLICATION_JSON_VALUE)
@Tag(name = "Auth registration")
public class RegistrationController {
  private final RegistrationService registration;

  public RegistrationController(RegistrationService registration) {
    this.registration = registration;
  }

  @GetMapping("/email-availability")
  @Operation(summary = "이메일 중복 확인")
  public ApiResponse<EmailAvailabilityResponse> checkEmail(@RequestParam String email) {
    return ApiResponse.ok(registration.checkEmail(email), "OK");
  }

  @PostMapping(value = "/register", consumes = MediaType.APPLICATION_JSON_VALUE)
  @Operation(summary = "이메일 회원가입")
  public ResponseEntity<ApiResponse<RegistrationResponse>> register(
      @Valid @RequestBody RegistrationRequest request) {
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(ApiResponse.ok(registration.register(request), "회원가입이 완료되었습니다."));
  }
}
