package com.peakorder.menu.service;

import com.peakorder.menu.dto.AdminMenuDetail;
import com.peakorder.menu.dto.AdminMenuList;
import com.peakorder.menu.entity.Category;
import com.peakorder.menu.entity.Menu;
import com.peakorder.menu.entity.MenuStatus;
import com.peakorder.menu.exception.AdminMenuQueryException;
import com.peakorder.menu.repository.AdminMenuQueryRepository;
import com.peakorder.menu.repository.CategoryRepository;
import java.util.Comparator;
import java.util.Locale;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Administrator read foundation. Authorization must precede any future HTTP exposure. */
@Service
@Transactional(readOnly = true)
public class AdminMenuQueryService {
  private final AdminMenuQueryRepository menus;
  private final CategoryRepository categories;

  public AdminMenuQueryService(AdminMenuQueryRepository menus, CategoryRepository categories) {
    this.menus = menus;
    this.categories = categories;
  }

  public AdminMenuList list(Long categoryId, String query, String status, String sort) {
    if (categoryId != null && categoryId <= 0) {
      throw AdminMenuQueryException.invalidRequest();
    }
    MenuStatus selectedStatus = null;
    if (status != null) {
      try {
        selectedStatus = MenuStatus.valueOf(status);
      } catch (IllegalArgumentException exception) {
        throw AdminMenuQueryException.invalidRequest();
      }
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
          default -> throw AdminMenuQueryException.invalidRequest();
        };
    String search = query == null ? "" : query.strip().toLowerCase(Locale.ROOT);
    MenuStatus filterStatus = selectedStatus;
    var categoryItems =
        categories.findAll().stream()
            .sorted(Comparator.comparingInt(Category::getSortOrder).thenComparing(Category::getId))
            .map(c -> new AdminMenuList.CategoryItem(c.getId(), c.getName()))
            .toList();
    var menuItems =
        menus.findAllWithCategory().stream()
            .filter(m -> categoryId == null || categoryId.equals(m.getCategory().getId()))
            .filter(m -> filterStatus == null || filterStatus == m.getStatus())
            .filter(m -> m.getName().toLowerCase(Locale.ROOT).contains(search))
            .sorted(order)
            .map(
                m ->
                    new AdminMenuList.MenuItem(
                        m.getId(),
                        m.getCategory().getId(),
                        m.getName(),
                        m.getImageUrl(),
                        m.getBasePrice(),
                        m.getCookTimeSec(),
                        m.getStatus()))
            .toList();
    return new AdminMenuList(categoryItems, menuItems);
  }

  public AdminMenuDetail detail(Long menuId) {
    if (menuId == null || menuId <= 0) {
      throw AdminMenuQueryException.invalidRequest();
    }
    var menu = menus.findWithCategoryById(menuId).orElseThrow(AdminMenuQueryException::notFound);
    var options =
        menus.findOptionsByMenuId(menuId).stream()
            .map(
                o ->
                    new AdminMenuDetail.Option(
                        o.getId(),
                        o.getName(),
                        o.getExtraPrice(),
                        o.getExtraCookTimeSec(),
                        o.isDefault(),
                        o.isActive()))
            .toList();
    return new AdminMenuDetail(
        menu.getId(),
        menu.getCategory().getId(),
        menu.getName(),
        menu.getDescription(),
        menu.getImageUrl(),
        menu.getBasePrice(),
        menu.getCookTimeSec(),
        menu.getStatus(),
        menu.getCreatedAt(),
        menu.getUpdatedAt(),
        options);
  }
}
