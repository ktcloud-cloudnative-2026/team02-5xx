package com.peakorder.menu.service;

import com.peakorder.menu.exception.MenuStatusChangeException;
import org.springframework.stereotype.Component;

/** Deny-only boundary until reviewed shared authentication integration. */
@Component
public class MenuStatusAuthorization {
  public void requireStoreAdmin() {
    throw MenuStatusChangeException.forbidden();
  }
}
