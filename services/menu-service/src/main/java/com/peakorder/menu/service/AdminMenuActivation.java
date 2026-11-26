package com.peakorder.menu.service;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/** Deployment gate only; this does not authenticate a request or prove Gateway provenance. */
@Component
public class AdminMenuActivation {
  private final boolean enabled;

  public AdminMenuActivation(@Value("${menu.admin.enabled:false}") boolean enabled) {
    this.enabled = enabled;
  }

  public boolean isEnabled() {
    return enabled;
  }
}
