package com.peakorder.menu.service;

import com.peakorder.menu.dto.CustomerMenuDetail;
import com.peakorder.menu.dto.CustomerMenuList;
import com.peakorder.menu.entity.Category;
import com.peakorder.menu.entity.Menu;
import com.peakorder.menu.entity.MenuStatus;
import com.peakorder.menu.exception.CustomerMenuException;
import com.peakorder.menu.repository.CategoryRepository;
import com.peakorder.menu.repository.MenuOptionRepository;
import com.peakorder.menu.repository.MenuRepository;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@Transactional(readOnly = true)
public class CustomerMenuService {
  private final MenuRepository menus;
  private final CategoryRepository categories;
  private final MenuOptionRepository options;

  public CustomerMenuService(
      MenuRepository menus, CategoryRepository categories, MenuOptionRepository options) {
    this.menus = menus;
    this.categories = categories;
    this.options = options;
  }

  public CustomerMenuList list(Long categoryId, String query, String sort) {
    if (categoryId != null && categoryId <= 0) {
      throw CustomerMenuException.invalidRequest();
    }
    Comparator<Menu> order =
        switch (sort == null ? "default" : sort) {
          case "default" ->
              Comparator.comparingInt((Menu m) -> m.getCategory().getSortOrder())
                  .thenComparing(m -> m.getCategory().getId())
                  .thenComparing(Menu::getId);
          case "priceAsc" -> Comparator.comparingInt(Menu::getBasePrice).thenComparing(Menu::getId);
          case "priceDesc" ->
              Comparator.comparingInt(Menu::getBasePrice).reversed().thenComparing(Menu::getId);
          default -> throw CustomerMenuException.invalidRequest();
        };
    String search = query == null ? "" : query.strip().toLowerCase(Locale.ROOT);
    var categoryItems =
        categories.findAll().stream()
            .sorted(Comparator.comparingInt(Category::getSortOrder).thenComparing(Category::getId))
            .map(c -> new CustomerMenuList.CategoryItem(c.getId(), c.getName()))
            .toList();
    var menuItems =
        menus.findByStatusIn(List.of(MenuStatus.ON_SALE, MenuStatus.PAUSED)).stream()
            .filter(m -> categoryId == null || categoryId.equals(m.getCategory().getId()))
            .filter(m -> m.getName().toLowerCase(Locale.ROOT).contains(search))
            .sorted(order)
            .map(
                m ->
                    new CustomerMenuList.MenuItem(
                        m.getId(),
                        m.getCategory().getId(),
                        m.getName(),
                        m.getImageUrl(),
                        m.getBasePrice(),
                        m.getStatus()))
            .toList();
    return new CustomerMenuList(categoryItems, menuItems);
  }

  public CustomerMenuDetail detail(Long menuId) {
    if (menuId == null || menuId <= 0) {
      throw CustomerMenuException.invalidRequest();
    }
    var menu =
        menus
            .findById(menuId)
            .filter(m -> m.getStatus() != MenuStatus.HIDDEN)
            .orElseThrow(CustomerMenuException::notFound);
    var optionItems =
        options.findByMenuIdOrderByIdAsc(menuId).stream()
            .map(
                o ->
                    new CustomerMenuDetail.Option(
                        o.getId(), o.getName(), o.getExtraPrice(), o.isDefault(), o.isActive()))
            .toList();
    return new CustomerMenuDetail(
        menu.getId(),
        menu.getCategory().getId(),
        menu.getName(),
        menu.getDescription(),
        menu.getImageUrl(),
        menu.getBasePrice(),
        menu.getStatus(),
        optionItems);
  }
}
