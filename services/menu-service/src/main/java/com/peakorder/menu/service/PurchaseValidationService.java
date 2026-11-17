package com.peakorder.menu.service;

import com.peakorder.menu.dto.ValidatePurchaseRequest;
import com.peakorder.menu.dto.ValidatePurchaseResponse;
import com.peakorder.menu.entity.Menu;
import com.peakorder.menu.entity.MenuOption;
import com.peakorder.menu.entity.MenuStatus;
import com.peakorder.menu.exception.PurchaseValidationException;
import com.peakorder.menu.repository.MenuOptionRepository;
import com.peakorder.menu.repository.MenuRepository;
import java.util.HashSet;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class PurchaseValidationService {
  private final MenuRepository menus;
  private final MenuOptionRepository options;

  public PurchaseValidationService(MenuRepository menus, MenuOptionRepository options) {
    this.menus = menus;
    this.options = options;
  }

  @Transactional(readOnly = true)
  public ValidatePurchaseResponse validate(ValidatePurchaseRequest request) {
    validateRequest(request);
    var menuIds =
        request.items().stream().map(ValidatePurchaseRequest.Item::menuId).distinct().toList();
    var optionIds =
        request.items().stream().flatMap(item -> item.optionIds().stream()).distinct().toList();
    Map<Long, Menu> menuMap =
        menus.findAllById(menuIds).stream()
            .collect(Collectors.toMap(Menu::getId, Function.identity()));
    Map<Long, MenuOption> optionMap =
        options.findAllById(optionIds).stream()
            .collect(Collectors.toMap(MenuOption::getId, Function.identity()));
    return new ValidatePurchaseResponse(
        request.items().stream().map(item -> validateItem(item, menuMap, optionMap)).toList());
  }

  private void validateRequest(ValidatePurchaseRequest request) {
    if (request == null || request.items() == null || request.items().isEmpty()) {
      throw new PurchaseValidationException("items must contain at least one item");
    }
    for (var item : request.items()) {
      if (item == null
          || item.menuId() == null
          || item.menuId() <= 0
          || item.quantity() == null
          || item.quantity() <= 0
          || item.optionIds() == null) {
        throw new PurchaseValidationException(
            "Positive menuId and quantity and an optionIds array are required");
      }
      var seen = new HashSet<Long>();
      for (var id : item.optionIds()) {
        if (id == null || id <= 0 || !seen.add(id)) {
          throw new PurchaseValidationException("optionIds must contain distinct positive IDs");
        }
      }
    }
  }

  private ValidatePurchaseResponse.Item validateItem(
      ValidatePurchaseRequest.Item item, Map<Long, Menu> menuMap, Map<Long, MenuOption> optionMap) {
    var menu = menuMap.get(item.menuId());
    if (menu == null || menu.getStatus() != MenuStatus.ON_SALE) {
      throw new PurchaseValidationException("Menu is not available for purchase");
    }
    validateStoredValues(menu.getName(), menu.getBasePrice(), menu.getCookTimeSec());
    var selectedOptions =
        item.optionIds().stream()
            .map(
                id -> {
                  var option = optionMap.get(id);
                  if (option == null
                      || !option.isActive()
                      || !menu.getId().equals(option.getMenu().getId())) {
                    throw new PurchaseValidationException("Option is not available for this menu");
                  }
                  validateStoredValues(
                      option.getName(), option.getExtraPrice(), option.getExtraCookTimeSec());
                  return new ValidatePurchaseResponse.Option(
                      option.getId(),
                      option.getName(),
                      option.getExtraPrice(),
                      option.getExtraCookTimeSec());
                })
            .toList();
    return new ValidatePurchaseResponse.Item(
        menu.getId(), menu.getName(), menu.getBasePrice(), menu.getCookTimeSec(), selectedOptions);
  }

  private void validateStoredValues(String name, int price, int cookTimeSec) {
    if (name == null || name.isBlank() || price < 0 || cookTimeSec < 0) {
      throw new IllegalStateException("Invalid stored menu values");
    }
  }
}
