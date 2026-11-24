package com.peakorder.menu.service;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.peakorder.menu.exception.AdminMenuAccessException;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullAndEmptySource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

class AdminMenuAuthorizationTests {
  private final AdminMenuGatewayTrust trust = mock(AdminMenuGatewayTrust.class);
  private final AdminMenuAuthorization policy = new AdminMenuAuthorization(trust);
  private final MockHttpServletRequest request = new MockHttpServletRequest();

  private void identity(String id, String role) {
    if (id != null) request.addHeader("X-User-Id", id);
    if (role != null) request.addHeader("X-User-Role", role);
    RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
    when(trust.isVerified(request)).thenReturn(true);
  }

  @AfterEach
  void clearContext() {
    RequestContextHolder.resetRequestAttributes();
  }

  private void denied(int status, String code) {
    assertThatThrownBy(policy::requireStoreAdmin)
        .isInstanceOfSatisfying(
            AdminMenuAccessException.class,
            e -> {
              assertThat(e.status()).isEqualTo(status);
              assertThat(e.errorCode()).isEqualTo(code);
            });
  }

  @Test
  void noServletContextCannotEstablishTrust() {
    denied(403, "FORBIDDEN");
    verifyNoInteractions(trust);
  }

  @Test
  void arbitraryHeadersAndServletIdentityNeverEnableDefaultBoundary() {
    identity("42", "STORE_ADMIN");
    request.addHeader("Authorization", "Bearer unverified.payload.signature");
    request.setUserPrincipal(() -> "42");
    request.addUserRole("STORE_ADMIN");
    assertThat(new AdminMenuGatewayTrust().isVerified(request)).isFalse();
    assertThatThrownBy(new AdminMenuAuthorization(new AdminMenuGatewayTrust())::requireStoreAdmin)
        .isInstanceOfSatisfying(
            AdminMenuAccessException.class, e -> assertThat(e.status()).isEqualTo(403));
  }

  @Test
  void simulatedTrustedAdminPassesSharedPolicy() {
    identity("42", "STORE_ADMIN");
    assertThatCode(policy::requireStoreAdmin).doesNotThrowAnyException();
  }

  @ParameterizedTest
  @NullAndEmptySource
  @ValueSource(strings = {"0", "00", "01", "007", "00042", "-1", "+1", " 1", "1 ", "1.0", "1,2", "abc", "9223372036854775808"})
  void missingOrMalformedSubjectIs401OnlyAfterTrust(String id) {
    identity(id, "STORE_ADMIN");
    denied(401, "UNAUTHORIZED");
  }

  @ParameterizedTest
  @NullAndEmptySource
  @ValueSource(strings = {"ADMIN", "store_admin", " STORE_ADMIN", "STORE_ADMIN,CUSTOMER"})
  void missingOrMalformedRoleIs401(String role) {
    identity("42", role);
    denied(401, "UNAUTHORIZED");
  }

  @ParameterizedTest
  @ValueSource(strings = {"X-User-Id", "X-User-Role"})
  void duplicateEvenIdenticalHeadersAre401(String name) {
    identity("42", "STORE_ADMIN");
    request.addHeader(name.toLowerCase(), name.equals("X-User-Id") ? "42" : "STORE_ADMIN");
    denied(401, "UNAUTHORIZED");
  }

  @Test
  void authenticatedCustomerIs403Not401() {
    identity("42", "CUSTOMER");
    denied(403, "FORBIDDEN");
  }
}
