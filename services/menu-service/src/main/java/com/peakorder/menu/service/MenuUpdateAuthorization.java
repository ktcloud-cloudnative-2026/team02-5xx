package com.peakorder.menu.service;

import com.peakorder.menu.exception.MenuUpdateException;
import org.springframework.stereotype.Component;

/** Independent deny-only boundary until reviewed #112 and predecessor PR integration. */
@Component
public class MenuUpdateAuthorization {
  public void requireStoreAdmin() {
    throw MenuUpdateException.forbidden();
  }
}
