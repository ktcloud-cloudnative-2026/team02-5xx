package com.peakorder.menu.service;

import com.peakorder.menu.exception.AdminMenuAccessException;
import org.springframework.stereotype.Component;

/** Fail-closed boundary until a reviewed, verifiable STORE_ADMIN integration exists. */
@Component
public final class AdminMenuAuthorization {
  public void requireStoreAdmin() {
    // No request header, principal, property or profile can enable administrator access.
    // Replacing this denial requires a reviewed authentication/authorization implementation.
    throw AdminMenuAccessException.forbidden();
  }
}
