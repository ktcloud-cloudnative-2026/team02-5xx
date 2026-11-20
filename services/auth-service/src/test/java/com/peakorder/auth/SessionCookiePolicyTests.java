package com.peakorder.auth;

import static com.peakorder.auth.AuthSessionTestSupport.*;
import static org.assertj.core.api.Assertions.*;

import com.peakorder.auth.config.SessionCookiePolicy;
import com.peakorder.auth.config.SessionProperties;
import com.peakorder.auth.exception.BusinessException;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.mock.web.MockHttpServletRequest;

class SessionCookiePolicyTests {
  private final SessionCookiePolicy policy = new SessionCookiePolicy(properties(), CLOCK);

  @Test
  void distinguishesSessionAndRememberedCookiesAndClearsSameScope() {
    String session = policy.issue(RAW, false, NOW.plusSeconds(86400));
    String persistent = policy.issue(RAW, true, NOW.plusSeconds(1209600));
    for (String value : List.of(session, persistent, policy.clear()))
      assertThat(value)
          .contains("Path=/api/v1/auth", "Secure", "HttpOnly", "SameSite=Strict")
          .doesNotContain("Domain=");
    assertThat(session).doesNotContain("Max-Age", "Expires");
    assertThat(persistent).contains("Max-Age=1209600");
    assertThat(policy.clear()).contains("Max-Age=0");
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "null",
        "https://evil.example.test",
        "https://web.example.test.evil.test",
        "https://web.example.test/path",
        "https://web.example.test?x=1",
        "https://u@web.example.test"
      })
  void rejectsUntrustedAndMalformedOrigin(String value) {
    var request = new MockHttpServletRequest();
    request.addHeader("Origin", value);
    assertThatThrownBy(() -> policy.checkSource(request)).isInstanceOf(BusinessException.class);
  }

  @Test
  void allowsExactOriginOrRefererAndRejectsAbsentOrDuplicateSource() {
    var request = new MockHttpServletRequest();
    assertThatThrownBy(() -> policy.checkSource(request)).isInstanceOf(BusinessException.class);
    request.addHeader("Referer", ORIGIN + "/menu?x=1");
    policy.checkSource(request);
    request.addHeader("Origin", ORIGIN);
    policy.checkSource(request);
    request.addHeader("Origin", ORIGIN);
    assertThatThrownBy(() -> policy.checkSource(request)).isInstanceOf(BusinessException.class);
  }

  @Test
  void doesNotTrustForwardedHostOrFallBackFromInvalidOrigin() {
    var request = new MockHttpServletRequest();
    request.addHeader("Origin", "null");
    request.addHeader("Referer", ORIGIN + "/menu");
    request.addHeader("X-Forwarded-Host", "web.example.test");
    assertThatThrownBy(() -> policy.checkSource(request)).isInstanceOf(BusinessException.class);
  }

  @ParameterizedTest
  @ValueSource(strings = {"*", "http://remote.example.test", "https://web.example.test/", "null"})
  void rejectsUnsafeConfiguration(String origin) {
    var p =
        new SessionProperties(
            "issuer",
            "audience",
            "key",
            "private",
            "public",
            List.of(origin),
            "peakorderRefreshToken");
    assertThatThrownBy(() -> new SessionCookiePolicy(p, CLOCK))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
