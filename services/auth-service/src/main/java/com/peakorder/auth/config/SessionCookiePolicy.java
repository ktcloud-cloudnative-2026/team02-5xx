package com.peakorder.auth.config;

import com.peakorder.auth.exception.BusinessException;
import com.peakorder.auth.exception.ErrorCode;
import jakarta.servlet.http.HttpServletRequest;
import java.net.URI;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Collections;
import java.util.Set;
import java.util.stream.Collectors;
import org.springframework.http.ResponseCookie;

public class SessionCookiePolicy {
  public static final String COOKIE_PATH = "/api/v1/auth";
  private final String cookieName;
  private final Set<String> origins;
  private final Clock clock;

  public SessionCookiePolicy(SessionProperties properties, Clock clock) {
    this.cookieName = properties.cookieName();
    if (cookieName == null || !cookieName.matches("[A-Za-z][A-Za-z0-9_-]{0,63}"))
      throw new IllegalArgumentException("Refresh 쿠키 이름을 확인해 주세요.");
    this.origins =
        properties.allowedOrigins().stream()
            .map(value -> origin(value, false))
            .collect(Collectors.toUnmodifiableSet());
    if (origins.isEmpty()) throw new IllegalArgumentException("허용 Origin 설정이 필요합니다.");
    this.clock = clock;
  }

  public void checkSource(HttpServletRequest request) {
    try {
      var supplied = Collections.list(request.getHeaders("Origin"));
      String actual;
      if (!supplied.isEmpty()) {
        if (supplied.size() != 1) throw new IllegalArgumentException();
        actual = origin(supplied.getFirst(), false);
      } else {
        var referers = Collections.list(request.getHeaders("Referer"));
        if (referers.size() != 1) throw new IllegalArgumentException();
        actual = origin(referers.getFirst(), true);
      }
      if (!origins.contains(actual)) throw new IllegalArgumentException();
    } catch (IllegalArgumentException exception) {
      throw new BusinessException(ErrorCode.FORBIDDEN);
    }
  }

  private static String origin(String value, boolean referer) {
    URI uri = URI.create(value);
    String scheme =
        uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(java.util.Locale.ROOT);
    String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase(java.util.Locale.ROOT);
    boolean local = host.equals("localhost") || host.equals("127.0.0.1") || host.equals("[::1]");
    if (host.isEmpty()
        || !(scheme.equals("https") || (scheme.equals("http") && local))
        || uri.getUserInfo() != null
        || uri.getRawFragment() != null
        || uri.getPort() == 0
        || uri.getPort() > 65535
        || (!referer
            && ((uri.getRawPath() != null && !uri.getRawPath().isEmpty())
                || uri.getRawQuery() != null)))
      throw new IllegalArgumentException("Origin 구성을 확인해 주세요.");
    int port = uri.getPort();
    return scheme
        + "://"
        + host
        + ((port == -1
                || (scheme.equals("https") && port == 443)
                || (scheme.equals("http") && port == 80))
            ? ""
            : ":" + port);
  }

  public String cookieName() {
    return cookieName;
  }

  public String issue(String token, boolean rememberMe, Instant expiresAt) {
    var builder =
        ResponseCookie.from(cookieName, token)
            .httpOnly(true)
            .secure(true)
            .sameSite("Strict")
            .path(COOKIE_PATH);
    if (rememberMe) builder.maxAge(Duration.between(clock.instant(), expiresAt));
    return builder.build().toString();
  }

  public String clear() {
    return ResponseCookie.from(cookieName, "")
        .httpOnly(true)
        .secure(true)
        .sameSite("Strict")
        .path(COOKIE_PATH)
        .maxAge(0)
        .build()
        .toString();
  }
}
