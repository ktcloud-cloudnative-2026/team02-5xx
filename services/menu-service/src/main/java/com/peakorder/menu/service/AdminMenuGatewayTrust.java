package com.peakorder.menu.service;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.stereotype.Component;

/**
 * Deployment integration is intentionally unavailable. Header values, Bearer text, servlet
 * principals, profiles and properties cannot establish trust. Replace this denial only after
 * Gateway JWT/claim forwarding and direct-access/spoofing protection are verified and reviewed.
 */
@Component
public class AdminMenuGatewayTrust {
  public boolean isVerified(HttpServletRequest request) {
    return false;
  }
}
