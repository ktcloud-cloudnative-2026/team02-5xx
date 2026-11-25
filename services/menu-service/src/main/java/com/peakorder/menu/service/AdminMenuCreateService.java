package com.peakorder.menu.service;

import com.peakorder.menu.dto.AdminMenuCreateRequest;
import com.peakorder.menu.dto.AdminMenuCreated;
import com.peakorder.menu.entity.Menu;
import com.peakorder.menu.entity.MenuOption;
import com.peakorder.menu.exception.MenuCreateException;
import com.peakorder.menu.repository.CategoryRepository;
import com.peakorder.menu.repository.MenuOptionRepository;
import com.peakorder.menu.repository.MenuRepository;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AdminMenuCreateService {
  private final CategoryRepository categories;
  private final MenuRepository menus;
  private final MenuOptionRepository options;

  public AdminMenuCreateService(
      CategoryRepository categories, MenuRepository menus, MenuOptionRepository options) {
    this.categories = categories;
    this.menus = menus;
    this.options = options;
  }

  @Transactional
  public AdminMenuCreated create(AdminMenuCreateRequest request) {
    if (request == null
        || request.categoryId() == null
        || request.categoryId() <= 0
        || request.status() == null) throw MenuCreateException.invalid();
    name(request.name());
    text(request.description());
    text(request.imageUrl());
    if (request.imageUrl() != null
        && request.imageUrl().codePointCount(0, request.imageUrl().length()) > 255)
      throw MenuCreateException.invalid();
    nonNegative(request.basePrice());
    nonNegative(request.cookTimeSec());
    var selected =
        request.options() == null ? List.<AdminMenuCreateRequest.Option>of() : request.options();
    for (var option : selected) {
      if (option == null) throw MenuCreateException.invalid();
      name(option.name());
      nonNegative(option.extraPrice());
      nonNegative(option.extraCookTimeSec());
    }
    var category =
        categories.findById(request.categoryId()).orElseThrow(MenuCreateException::categoryMissing);
    var menu =
        menus.saveAndFlush(
            new Menu(
                category,
                request.name(),
                request.description(),
                request.imageUrl(),
                request.basePrice(),
                request.cookTimeSec(),
                request.status()));
    if (!selected.isEmpty()) {
      options.saveAllAndFlush(
          selected.stream()
              .map(
                  o ->
                      new MenuOption(
                          menu,
                          o.name(),
                          o.extraPrice(),
                          o.extraCookTimeSec(),
                          Boolean.TRUE.equals(o.isDefault()),
                          o.active() == null || o.active()))
              .toList());
    }
    return new AdminMenuCreated(menu.getId());
  }

  private void name(String value) {
    if (value == null
        || value.isBlank()
        || value.codePointCount(0, value.length()) > 255
        || value.indexOf('\0') >= 0) throw MenuCreateException.invalid();
  }

  private void text(String value) {
    if (value != null && value.indexOf('\0') >= 0) throw MenuCreateException.invalid();
  }

  private void nonNegative(Integer value) {
    if (value == null || value < 0) throw MenuCreateException.invalid();
  }
}
