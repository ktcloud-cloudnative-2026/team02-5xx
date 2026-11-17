package com.peakorder.menu.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.peakorder.menu.dto.ValidatePurchaseRequest;
import com.peakorder.menu.entity.Menu;
import com.peakorder.menu.entity.MenuOption;
import com.peakorder.menu.entity.MenuStatus;
import com.peakorder.menu.exception.PurchaseValidationException;
import com.peakorder.menu.repository.MenuOptionRepository;
import com.peakorder.menu.repository.MenuRepository;
import java.util.Arrays;
import java.util.List;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.test.util.ReflectionTestUtils;

class PurchaseValidationServiceTests {
  private final MenuRepository menus = mock(MenuRepository.class);
  private final MenuOptionRepository options = mock(MenuOptionRepository.class);
  private final PurchaseValidationService service = new PurchaseValidationService(menus, options);

  private Menu menu(long id, MenuStatus status, int price, int time) {
    var menu = new Menu(null, "Menu " + id, null, null, price, time, status);
    ReflectionTestUtils.setField(menu, "id", id);
    return menu;
  }

  private MenuOption option(long id, Menu owner, boolean active, int price, int time) {
    var option = new MenuOption(owner, "Option " + id, price, time, false, active);
    ReflectionTestUtils.setField(option, "id", id);
    return option;
  }

  private ValidatePurchaseRequest request(Long id, Integer qty, Long... ids) {
    return new ValidatePurchaseRequest(
        List.of(new ValidatePurchaseRequest.Item(id, qty, Arrays.asList(ids))));
  }

  @Test
  void preservesLineAndOptionOrderAndReturnsPerUnitValuesWithoutMultiplication() {
    var one = menu(1, MenuStatus.ON_SALE, 6500, 90);
    var two = menu(2, MenuStatus.ON_SALE, 0, 0);
    when(menus.findAllById(any())).thenReturn(List.of(two, one));
    when(options.findAllById(any()))
        .thenReturn(List.of(option(10, one, true, 2500, 30), option(11, one, true, 0, 0)));
    var result =
        service.validate(
            new ValidatePurchaseRequest(
                List.of(
                    new ValidatePurchaseRequest.Item(1L, 2, List.of(11L, 10L)),
                    new ValidatePurchaseRequest.Item(2L, 1, List.of()),
                    new ValidatePurchaseRequest.Item(1L, 3, List.of()))));
    assertThat(result.items()).extracting(i -> i.menuId()).containsExactly(1L, 2L, 1L);
    var first = result.items().getFirst();
    assertThat(first.menuName()).isEqualTo("Menu 1");
    assertThat(first.unitPrice()).isEqualTo(6500);
    assertThat(first.cookTimeSec()).isEqualTo(90);
    assertThat(first.options()).extracting(o -> o.optionId()).containsExactly(11L, 10L);
    assertThat(first.options().get(1).optionName()).isEqualTo("Option 10");
    assertThat(first.options().get(1).extraPrice()).isEqualTo(2500);
    assertThat(first.options().get(1).extraCookTimeSec()).isEqualTo(30);
    assertThat(result.items().get(1).unitPrice()).isZero();
    assertThat(result.items().get(2).options()).isEmpty();
    verify(menus).findAllById(List.of(1L, 2L));
    verify(options).findAllById(List.of(11L, 10L));
  }

  @ParameterizedTest
  @EnumSource(value = MenuStatus.class, names = {"PAUSED", "HIDDEN"})
  void rejectsNonSaleMenus(MenuStatus status) {
    when(menus.findAllById(any())).thenReturn(List.of(menu(1, status, 0, 0)));
    assertThatThrownBy(() -> service.validate(request(1L, 1)))
        .isInstanceOf(PurchaseValidationException.class);
  }

  @Test
  void rejectsMissingMenuAndReturnsNoPartialSuccess() {
    when(menus.findAllById(any())).thenReturn(List.of(menu(1, MenuStatus.ON_SALE, 0, 0)));
    var input =
        new ValidatePurchaseRequest(
            List.of(
                new ValidatePurchaseRequest.Item(1L, 1, List.of()),
                new ValidatePurchaseRequest.Item(2L, 1, List.of())));
    assertThatThrownBy(() -> service.validate(input))
        .isInstanceOf(PurchaseValidationException.class);
  }

  @Test
  void rejectsMissingInactiveAndForeignOptions() {
    var menu = menu(1, MenuStatus.ON_SALE, 0, 0);
    when(menus.findAllById(any())).thenReturn(List.of(menu));
    for (var list :
        List.of(
            List.<MenuOption>of(),
            List.of(option(10, menu, false, 0, 0)),
            List.of(option(10, menu(2, MenuStatus.ON_SALE, 0, 0), true, 0, 0)))) {
      when(options.findAllById(any())).thenReturn(list);
      assertThatThrownBy(() -> service.validate(request(1L, 1, 10L)))
          .isInstanceOf(PurchaseValidationException.class);
    }
  }

  static Stream<ValidatePurchaseRequest> invalidRequests() {
    return Stream.of(
        null,
        new ValidatePurchaseRequest(null),
        new ValidatePurchaseRequest(List.of()),
        new ValidatePurchaseRequest(Arrays.asList((ValidatePurchaseRequest.Item) null)),
        new ValidatePurchaseRequest(List.of(new ValidatePurchaseRequest.Item(null, 1, List.of()))),
        new ValidatePurchaseRequest(List.of(new ValidatePurchaseRequest.Item(0L, 1, List.of()))),
        new ValidatePurchaseRequest(List.of(new ValidatePurchaseRequest.Item(-1L, 1, List.of()))),
        new ValidatePurchaseRequest(List.of(new ValidatePurchaseRequest.Item(1L, null, List.of()))),
        new ValidatePurchaseRequest(List.of(new ValidatePurchaseRequest.Item(1L, 0, List.of()))),
        new ValidatePurchaseRequest(List.of(new ValidatePurchaseRequest.Item(1L, -1, List.of()))),
        new ValidatePurchaseRequest(List.of(new ValidatePurchaseRequest.Item(1L, 1, null))),
        new ValidatePurchaseRequest(
            List.of(new ValidatePurchaseRequest.Item(1L, 1, Arrays.asList((Long) null)))),
        new ValidatePurchaseRequest(List.of(new ValidatePurchaseRequest.Item(1L, 1, List.of(0L)))),
        new ValidatePurchaseRequest(List.of(new ValidatePurchaseRequest.Item(1L, 1, List.of(-1L)))),
        new ValidatePurchaseRequest(
            List.of(new ValidatePurchaseRequest.Item(1L, 1, List.of(10L, 10L)))));
  }

  @ParameterizedTest
  @MethodSource("invalidRequests")
  void rejectsInvalidInputBeforeQuerying(ValidatePurchaseRequest input) {
    assertThatThrownBy(() -> service.validate(input))
        .isInstanceOf(PurchaseValidationException.class);
    verifyNoInteractions(menus, options);
  }

  @Test
  void rejectsInvalidStoredMenuValues() {
    for (var menu :
        List.of(menu(1, MenuStatus.ON_SALE, -1, 0), menu(1, MenuStatus.ON_SALE, 0, -1))) {
      when(menus.findAllById(any())).thenReturn(List.of(menu));
      assertThatThrownBy(() -> service.validate(request(1L, 1)))
          .isInstanceOf(IllegalStateException.class);
    }
  }

  @Test
  void rejectsInvalidStoredOptionValues() {
    var menu = menu(1, MenuStatus.ON_SALE, 0, 0);
    when(menus.findAllById(any())).thenReturn(List.of(menu));
    for (var option :
        List.of(option(10, menu, true, -1, 0), option(10, menu, true, 0, -1))) {
      when(options.findAllById(any())).thenReturn(List.of(option));
      assertThatThrownBy(() -> service.validate(request(1L, 1, 10L)))
          .isInstanceOf(IllegalStateException.class);
    }
  }

  @Test
  void rejectsMissingOrBlankStoredNames() {
    for (var name : Arrays.asList(null, "", " ")) {
      var menu = menu(1, MenuStatus.ON_SALE, 0, 0);
      ReflectionTestUtils.setField(menu, "name", name);
      when(menus.findAllById(any())).thenReturn(List.of(menu));
      assertThatThrownBy(() -> service.validate(request(1L, 1)))
          .isInstanceOf(IllegalStateException.class);
    }
  }
}
