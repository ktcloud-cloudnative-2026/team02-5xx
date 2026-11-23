package com.peakorder.menu.service;

import com.peakorder.menu.dto.MenuStatusChanged;
import com.peakorder.menu.dto.MenuStatusRequest;
import com.peakorder.menu.exception.MenuStatusChangeException;
import com.peakorder.menu.repository.MenuRepository;
import com.peakorder.menu.repository.MenuStatusRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class MenuStatusService {
  private final MenuStatusRepository writes;
  private final MenuRepository menus;

  public MenuStatusService(MenuStatusRepository writes, MenuRepository menus) {
    this.writes = writes;
    this.menus = menus;
  }

  @Transactional
  public MenuStatusChanged change(Long menuId, MenuStatusRequest request) {
    if (menuId == null || menuId <= 0 || request == null || request.status() == null)
      throw MenuStatusChangeException.invalid();
    int changed = writes.changeIfDifferent(menuId, request.status().name());
    if (changed == 0 && !menus.existsById(menuId)) throw MenuStatusChangeException.missing();
    return new MenuStatusChanged(menuId, request.status());
  }
}
