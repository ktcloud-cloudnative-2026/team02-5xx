package com.peakorder.auth.controller;

import com.peakorder.auth.config.SessionCookiePolicy;
import com.peakorder.auth.dto.ApiResponse;
import com.peakorder.auth.dto.CurrentUserResponse;
import com.peakorder.auth.dto.PasswordChangeRequest;
import com.peakorder.auth.dto.ProfileUpdateRequest;
import com.peakorder.auth.exception.BusinessException;
import com.peakorder.auth.exception.ErrorCode;
import com.peakorder.auth.service.AccountService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping(value = "/api/v1/auth", produces = MediaType.APPLICATION_JSON_VALUE)
@Tag(name = "Auth account")
public class AccountController {
  private final ObjectProvider<AccountService> accounts;
  private final ObjectProvider<SessionCookiePolicy> cookies;

  public AccountController(
      ObjectProvider<AccountService> accounts, ObjectProvider<SessionCookiePolicy> cookies) {
    this.accounts = accounts;
    this.cookies = cookies;
  }

  @PatchMapping(value = "/me", consumes = MediaType.APPLICATION_JSON_VALUE)
  @Operation(summary = "본인 닉네임 변경 (CUSTOMER)")
  public ResponseEntity<ApiResponse<CurrentUserResponse>> updateProfile(
      @Valid @RequestBody ProfileUpdateRequest body, HttpServletRequest request) {
    var result = service().updateProfile(BearerAuthorization.token(request), body);
    return ResponseEntity.ok()
        .cacheControl(CacheControl.noStore())
        .body(ApiResponse.ok(result, "회원정보가 변경되었습니다."));
  }

  @PatchMapping(value = "/me/password", consumes = MediaType.APPLICATION_JSON_VALUE)
  @Operation(summary = "본인 비밀번호 변경 및 전체 Refresh 폐기 (CUSTOMER)")
  public ResponseEntity<Void> changePassword(
      @Valid @RequestBody PasswordChangeRequest body, HttpServletRequest request) {
    AccountService service = service();
    String access = BearerAuthorization.token(request);
    // Resolve the cookie policy before changing the password, so missing config cannot mutate DB.
    String clearCookie = policy().clear();
    service.changePassword(access, body);
    return ResponseEntity.noContent()
        .cacheControl(CacheControl.noStore())
        .header(HttpHeaders.SET_COOKIE, clearCookie)
        .build();
  }

  @ExceptionHandler(BusinessException.class)
  ResponseEntity<ApiResponse<Void>> businessFailure(BusinessException exception) {
    ErrorCode code = exception.errorCode();
    var response = ResponseEntity.status(code.status()).cacheControl(CacheControl.noStore());
    if (code == ErrorCode.UNAUTHORIZED) response.header(HttpHeaders.WWW_AUTHENTICATE, "Bearer");
    return response.body(ApiResponse.fail(code.name(), code.message()));
  }

  private AccountService service() {
    AccountService service = accounts.getIfAvailable();
    if (service == null) throw new BusinessException(ErrorCode.AUTHENTICATION_UNAVAILABLE);
    return service;
  }

  private SessionCookiePolicy policy() {
    SessionCookiePolicy policy = cookies.getIfAvailable();
    if (policy == null) throw new BusinessException(ErrorCode.AUTHENTICATION_UNAVAILABLE);
    return policy;
  }
}
