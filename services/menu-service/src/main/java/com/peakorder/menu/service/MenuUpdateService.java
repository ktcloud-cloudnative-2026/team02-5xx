package com.peakorder.menu.service;

import com.peakorder.menu.dto.MenuUpdateRequest;
import com.peakorder.menu.dto.MenuUpdated;
import com.peakorder.menu.entity.MenuOption;
import com.peakorder.menu.exception.MenuUpdateException;
import com.peakorder.menu.repository.CategoryRepository;
import com.peakorder.menu.repository.MenuOptionRepository;
import com.peakorder.menu.repository.MenuRepository;
import java.util.ArrayList;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;

@Service
public class MenuUpdateService {
  private final MenuRepository menus;
  private final MenuOptionRepository options;
  private final CategoryRepository categories;

  public MenuUpdateService(
      MenuRepository menus, MenuOptionRepository options, CategoryRepository categories) {
    this.menus = menus;
    this.options = options;
    this.categories = categories;
  }

  @Transactional
  public MenuUpdated update(Long menuId, MenuUpdateRequest request) {
    if (menuId == null || menuId <= 0 || request == null) throw MenuUpdateException.invalid();
    var patch = request.changes();
    var menu = menus.findForInformationUpdate(menuId).orElseThrow(MenuUpdateException::missingMenu);
    var category =
        patch.has("categoryId")
            ? categories
                .findById(patch.get("categoryId").longValue())
                .orElseThrow(MenuUpdateException::missingCategory)
            : menu.getCategory();
    var plans = new ArrayList<OptionPlan>();
    if (patch.has("options"))
      for (var item : patch.get("options")) {
        MenuOption option;
        if (item.has("optionId")) {
          option =
              options
                  .findById(item.get("optionId").longValue())
                  .orElseThrow(MenuUpdateException::missingOption);
          if (!menuId.equals(option.getMenu().getId())) throw MenuUpdateException.missingOption();
        } else {
          option =
              new MenuOption(
                  menu,
                  item.get("name").asString(),
                  item.get("extraPrice").intValue(),
                  item.get("extraCookTimeSec").intValue(),
                  false,
                  true);
        }
        plans.add(new OptionPlan(option, item));
      }
    // Resolve every reference before mutating any managed entity.
    menu.updateInformation(
        category,
        text(patch, "name", menu.getName()),
        text(patch, "description", menu.getDescription()),
        text(patch, "imageUrl", menu.getImageUrl()),
        number(patch, "basePrice", menu.getBasePrice()),
        number(patch, "cookTimeSec", menu.getCookTimeSec()));
    for (var plan : plans) {
      var o = plan.option();
      var p = plan.patch();
      o.updateInformation(
          text(p, "name", o.getName()),
          number(p, "extraPrice", o.getExtraPrice()),
          number(p, "extraCookTimeSec", o.getExtraCookTimeSec()),
          p.has("isDefault") ? p.get("isDefault").booleanValue() : o.isDefault(),
          p.has("active") ? p.get("active").booleanValue() : o.isActive());
    }
    if (!plans.isEmpty()) options.saveAllAndFlush(plans.stream().map(OptionPlan::option).toList());
    menus.flush();
    return new MenuUpdated(menuId);
  }

  private String text(JsonNode p, String key, String current) {
    return !p.has(key) ? current : p.get(key).isNull() ? null : p.get(key).asString();
  }

  private int number(JsonNode p, String key, int current) {
    return p.has(key) ? p.get(key).intValue() : current;
  }

  private record OptionPlan(MenuOption option, JsonNode patch) {}
}
