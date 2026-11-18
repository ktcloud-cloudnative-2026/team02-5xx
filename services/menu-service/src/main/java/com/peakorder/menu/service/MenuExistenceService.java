package com.peakorder.menu.service;

import com.peakorder.menu.dto.MenuExistenceResponse;
import com.peakorder.menu.exception.InvalidMenuIdException;
import com.peakorder.menu.repository.MenuRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class MenuExistenceService {
  private final MenuRepository menus;

  public MenuExistenceService(MenuRepository menus) {
    this.menus = menus;
  }

  @Transactional(readOnly = true)
  public MenuExistenceResponse check(Long menuId) {
    if (menuId == null || menuId <= 0) {
      throw new InvalidMenuIdException();
    }
    return menus
        .findById(menuId)
        .map(menu -> new MenuExistenceResponse(menuId, true, menu.getStatus()))
        .orElseGet(() -> new MenuExistenceResponse(menuId, false, null));
  }
}
