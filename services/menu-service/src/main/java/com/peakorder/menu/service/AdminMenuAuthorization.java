package com.peakorder.menu.service;

import com.peakorder.menu.exception.AdminMenuAccessException;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Collections;
import org.springframework.stereotype.Component;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

/** Shared ME-03~07 policy. Identity headers require a verified ingress boundary. */
@Component
public final class AdminMenuAuthorization {
  private final AdminMenuGatewayTrust gatewayTrust;

  public AdminMenuAuthorization(AdminMenuGatewayTrust gatewayTrust) {
    this.gatewayTrust = gatewayTrust;
  }

  public void requireStoreAdmin() {
    if (!(RequestContextHolder.getRequestAttributes()
            instanceof ServletRequestAttributes attributes)
        || !gatewayTrust.isVerified(attributes.getRequest())) {
      throw AdminMenuAccessException.forbidden();
    }
    var request = attributes.getRequest();
    var id = singleHeader(request, "X-User-Id");
    var role = singleHeader(request, "X-User-Role");
    try {
      if (!id.matches("[1-9][0-9]*") || Long.parseLong(id) <= 0)
        throw AdminMenuAccessException.unauthenticated();
    } catch (NumberFormatException exception) {
      throw AdminMenuAccessException.unauthenticated();
    }
    if (!role.equals("STORE_ADMIN") && !role.equals("CUSTOMER"))
      throw AdminMenuAccessException.unauthenticated();
    if (!role.equals("STORE_ADMIN")) throw AdminMenuAccessException.forbidden();
  }

  private String singleHeader(HttpServletRequest request, String name) {
    var values = Collections.list(request.getHeaders(name));
    if (values.size() != 1 || values.getFirst().isEmpty())
      throw AdminMenuAccessException.unauthenticated();
    return values.getFirst();
  }
}
