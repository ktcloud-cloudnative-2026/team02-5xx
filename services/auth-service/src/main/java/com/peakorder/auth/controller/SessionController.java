package com.peakorder.auth.controller;

import com.peakorder.auth.config.SessionCookiePolicy;
import com.peakorder.auth.dto.ApiResponse;
import com.peakorder.auth.dto.CurrentUserResponse;
import com.peakorder.auth.dto.LoginRequest;
import com.peakorder.auth.dto.SessionResponse;
import com.peakorder.auth.exception.BusinessException;
import com.peakorder.auth.exception.ErrorCode;
import com.peakorder.auth.service.SessionService;
import com.peakorder.auth.service.SessionService.SessionResult;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import java.io.IOException;
import java.util.Arrays;
import java.util.Map;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping(value = "/api/v1/auth", produces = MediaType.APPLICATION_JSON_VALUE)
@Tag(name = "Auth session")
public class SessionController {
  private final ObjectProvider<SessionService> services;
  private final ObjectProvider<SessionCookiePolicy> cookies;

  public SessionController(
      ObjectProvider<SessionService> services, ObjectProvider<SessionCookiePolicy> cookies) {
    this.services = services;
    this.cookies = cookies;
  }

  @PostMapping(value = "/login", consumes = MediaType.APPLICATION_JSON_VALUE)
  @Operation(summary = "이메일 로그인")
  public ResponseEntity<ApiResponse<SessionResponse>> login(
      @Valid @RequestBody LoginRequest body, HttpServletRequest request) {
    policy().checkSource(request);
    return session(service().login(body), "로그인되었습니다.");
  }

  @GetMapping("/me")
  @Operation(summary = "내 정보 조회")
  public ResponseEntity<ApiResponse<CurrentUserResponse>> me(HttpServletRequest request) {
    try {
      String token = BearerAuthorization.token(request);
      return ResponseEntity.ok()
          .cacheControl(CacheControl.noStore())
          .body(ApiResponse.ok(service().currentUser(token), "조회되었습니다."));
    } catch (BusinessException exception) {
      if (exception.errorCode() != ErrorCode.UNAUTHORIZED) throw exception;
      return ResponseEntity.status(ErrorCode.UNAUTHORIZED.status())
          .cacheControl(CacheControl.noStore())
          .header(HttpHeaders.WWW_AUTHENTICATE, "Bearer")
          .body(
              new ApiResponse<>(
                  false, null, ErrorCode.UNAUTHORIZED.message(), ErrorCode.UNAUTHORIZED.name()));
    }
  }

  @PostMapping("/refresh")
  @Operation(summary = "쿠키 기반 토큰 재발급")
  public ResponseEntity<ApiResponse<SessionResponse>> refresh(HttpServletRequest request)
      throws IOException {
    policy().checkSource(request);
    requireEmptyBody(request);
    return session(service().refresh(refreshCookie(request)), "재발급되었습니다.");
  }

  @PostMapping("/logout")
  @Operation(summary = "현재 로그인 세션 로그아웃")
  public ResponseEntity<Void> logout(HttpServletRequest request) throws IOException {
    policy().checkSource(request);
    requireEmptyBody(request);
    service().logout(refreshCookie(request));
    return ResponseEntity.noContent()
        .cacheControl(CacheControl.noStore())
        .header(HttpHeaders.SET_COOKIE, policy().clear())
        .build();
  }

  @GetMapping("/jwks")
  @Operation(summary = "JWT 공개 검증키 (JWK Set)")
  public ResponseEntity<Map<String, Object>> jwks() {
    // Protocol metadata: the standard raw JWK Set is not a business API envelope.
    return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service().publicKeys());
  }

  private ResponseEntity<ApiResponse<SessionResponse>> session(
      SessionResult result, String message) {
    return ResponseEntity.ok()
        .cacheControl(CacheControl.noStore())
        .header(
            HttpHeaders.SET_COOKIE,
            policy().issue(result.refreshToken(), result.rememberMe(), result.expiresAt()))
        .body(ApiResponse.ok(result.response(), message));
  }

  private String refreshCookie(HttpServletRequest request) {
    var supplied = request.getCookies();
    if (supplied == null) return null;
    var matches =
        Arrays.stream(supplied)
            .filter(cookie -> cookie.getName().equals(policy().cookieName()))
            .toList();
    if (matches.size() > 1) throw new BusinessException(ErrorCode.INVALID_REQUEST);
    return matches.isEmpty() ? null : matches.getFirst().getValue();
  }

  private static void requireEmptyBody(HttpServletRequest request) throws IOException {
    if (request.getInputStream().read() != -1)
      throw new BusinessException(ErrorCode.INVALID_REQUEST);
  }

  private SessionService service() {
    SessionService service = services.getIfAvailable();
    if (service == null) throw new BusinessException(ErrorCode.AUTHENTICATION_UNAVAILABLE);
    return service;
  }

  private SessionCookiePolicy policy() {
    SessionCookiePolicy policy = cookies.getIfAvailable();
    if (policy == null) throw new BusinessException(ErrorCode.AUTHENTICATION_UNAVAILABLE);
    return policy;
  }
}
