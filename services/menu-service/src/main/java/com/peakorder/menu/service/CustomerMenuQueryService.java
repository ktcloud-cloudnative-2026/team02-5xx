package com.peakorder.menu.service;

import com.peakorder.menu.dto.CustomerMenuDetailResponse;
import com.peakorder.menu.dto.CustomerMenuListResponse;
import com.peakorder.menu.entity.Menu;
import com.peakorder.menu.entity.MenuStatus;
import com.peakorder.menu.exception.CustomerMenuNotFoundException;
import com.peakorder.menu.exception.CustomerMenuQueryException;
import com.peakorder.menu.repository.CategoryRepository;
import com.peakorder.menu.repository.MenuOptionRepository;
import com.peakorder.menu.repository.MenuRepository;
import java.util.Comparator;
import java.util.Locale;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class CustomerMenuQueryService {
  private final CategoryRepository categories;
  private final MenuRepository menus;
  private final MenuOptionRepository options;

  public CustomerMenuQueryService(
      CategoryRepository categories, MenuRepository menus, MenuOptionRepository options) {
    this.categories = categories;
    this.menus = menus;
    this.options = options;
  }

  @Transactional(readOnly = true)
  public CustomerMenuListResponse list(String rawCategoryId, String rawQuery, String rawSort) {
    Long categoryId = positiveId(rawCategoryId, "categoryId", true);
    String sort = rawSort == null ? "default" : rawSort;
    if (!sort.equals("default") && !sort.equals("priceAsc") && !sort.equals("priceDesc")) {
      throw new CustomerMenuQueryException("sort must be default, priceAsc or priceDesc");
    }
    String keyword = rawQuery == null ? "" : rawQuery.strip().toLowerCase(Locale.ROOT);
    var categoryItems =
        categories.findAllByOrderBySortOrderAscIdAsc().stream()
            .map(c -> new CustomerMenuListResponse.CategoryItem(c.getId(), c.getName()))
            .toList();
    var menuItems =
        menus.findAllByStatusNot(MenuStatus.HIDDEN).stream()
            .filter(menu -> menu.getStatus() != MenuStatus.HIDDEN)
            .filter(menu -> categoryId == null || categoryId.equals(menu.getCategory().getId()))
            .filter(menu -> menu.getName().toLowerCase(Locale.ROOT).contains(keyword))
            .sorted(comparatorFor(sort))
            .map(
                menu ->
                    new CustomerMenuListResponse.MenuItem(
                        menu.getId(),
                        menu.getCategory().getId(),
                        menu.getName(),
                        menu.getImageUrl(),
                        menu.getBasePrice(),
                        menu.getStatus()))
            .toList();
    return new CustomerMenuListResponse(categoryItems, menuItems);
  }

  @Transactional(readOnly = true)
  public CustomerMenuDetailResponse detail(String rawMenuId) {
    Long menuId = positiveId(rawMenuId, "menuId", false);
    var menu =
        menus
            .findById(menuId)
            .filter(value -> value.getStatus() != MenuStatus.HIDDEN)
            .orElseThrow(CustomerMenuNotFoundException::new);
    var optionItems =
        options.findByMenuIdOrderByIdAsc(menuId).stream()
            .sorted(Comparator.comparing(option -> option.getId()))
            .map(
                option ->
                    new CustomerMenuDetailResponse.OptionItem(
                        option.getId(),
                        option.getName(),
                        option.getExtraPrice(),
                        option.isDefault(),
                        option.isActive()))
            .toList();
    return new CustomerMenuDetailResponse(
        menu.getId(),
        menu.getCategory().getId(),
        menu.getName(),
        menu.getDescription(),
        menu.getImageUrl(),
        menu.getBasePrice(),
        menu.getStatus(),
        optionItems);
  }

  private static Comparator<Menu> comparatorFor(String sort) {
    return switch (sort) {
      case "priceAsc" ->
          Comparator.comparingInt(Menu::getBasePrice).thenComparing(Menu::getId);
      case "priceDesc" ->
          Comparator.comparingInt(Menu::getBasePrice).reversed().thenComparing(Menu::getId);
      default ->
          Comparator.comparingInt((Menu menu) -> menu.getCategory().getSortOrder())
              .thenComparing(menu -> menu.getCategory().getId())
              .thenComparing(Menu::getId);
    };
  }

  private static Long positiveId(String raw, String field, boolean optional) {
    if (raw == null && optional) {
      return null;
    }
    if (raw == null || !raw.matches("[0-9]+")) {
      throw new CustomerMenuQueryException(field + " must be a positive Long integer");
    }
    try {
      long id = Long.parseLong(raw);
      if (id > 0) {
        return id;
      }
    } catch (NumberFormatException ignored) {
      // Values outside the Long range are invalid client input.
    }
    throw new CustomerMenuQueryException(field + " must be a positive Long integer");
  }
}
