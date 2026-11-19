package com.peakorder.menu.service;

import com.peakorder.menu.exception.MenuCreateException;
import org.springframework.stereotype.Component;

/** Replace with the shared administrator boundary only after #112/#117 integration review. */
@Component
public class MenuCreateAuthorization {
  public void requireStoreAdmin() {
    throw MenuCreateException.forbidden();
  }
}
