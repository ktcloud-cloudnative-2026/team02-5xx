package com.peakorder.menu.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.peakorder.menu.entity.Category;
import com.peakorder.menu.entity.Menu;
import com.peakorder.menu.entity.MenuOption;
import com.peakorder.menu.entity.MenuStatus;
import com.peakorder.menu.exception.CustomerMenuNotFoundException;
import com.peakorder.menu.exception.CustomerMenuQueryException;
import com.peakorder.menu.repository.CategoryRepository;
import com.peakorder.menu.repository.MenuOptionRepository;
import com.peakorder.menu.repository.MenuRepository;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.test.util.ReflectionTestUtils;

class CustomerMenuQueryServiceTests {
  private final CategoryRepository categories = mock(CategoryRepository.class);
  private final MenuRepository menus = mock(MenuRepository.class);
  private final MenuOptionRepository options = mock(MenuOptionRepository.class);
  private final CustomerMenuQueryService service =
      new CustomerMenuQueryService(categories, menus, options);

  private Category category(long id, int sortOrder) {
    var category = new Category("Category " + id, sortOrder);
    ReflectionTestUtils.setField(category, "id", id);
    return category;
  }

  private Menu menu(long id, Category category, String name, int price, MenuStatus status) {
    var menu = new Menu(category, name, null, null, price, 90, status);
    ReflectionTestUtils.setField(menu, "id", id);
    return menu;
  }

  private MenuOption option(long id, Menu menu, boolean defaultOption, boolean active) {
    var option = new MenuOption(menu, "Option " + id, 2500, 30, defaultOption, active);
    ReflectionTestUtils.setField(option, "id", id);
    return option;
  }

  @Test
  void listsAllCategoriesAndOrdersVisibleMenusByCategoryAndId() {
    var firstCategory = category(3, 1);
    var secondCategory = category(1, 2);
    var firstMenu = menu(12, firstCategory, "B", 7000, MenuStatus.PAUSED);
    var secondMenu = menu(10, firstCategory, "A", 8000, MenuStatus.ON_SALE);
    var lastMenu = menu(11, secondCategory, "C", 5000, MenuStatus.ON_SALE);
    var hidden = menu(9, firstCategory, "Hidden", 100, MenuStatus.HIDDEN);
    when(categories.findAllByOrderBySortOrderAscIdAsc())
        .thenReturn(List.of(firstCategory, secondCategory));
    when(menus.findAllByStatusNot(MenuStatus.HIDDEN))
        .thenReturn(List.of(lastMenu, firstMenu, hidden, secondMenu));

    var response = service.list(null, null, null);

    assertThat(response.categories()).extracting(c -> c.id()).containsExactly(3L, 1L);
    assertThat(response.menus()).extracting(m -> m.id()).containsExactly(10L, 12L, 11L);
    assertThat(response.menus().get(1).status()).isEqualTo(MenuStatus.PAUSED);
    assertThat(response.menus().getFirst().categoryId()).isEqualTo(3L);
    verify(menus).findAllByStatusNot(MenuStatus.HIDDEN);
    verifyNoInteractions(options);
  }

  @Test
  void filtersByCategoryAndCaseInsensitiveTrimmedName() {
    var category = category(1, 0);
    var otherCategory = category(2, 0);
    when(menus.findAllByStatusNot(MenuStatus.HIDDEN))
        .thenReturn(
            List.of(
                menu(1, category, "Classic BURGER", 6500, MenuStatus.ON_SALE),
                menu(2, category, "Coffee", 2000, MenuStatus.ON_SALE),
                menu(3, otherCategory, "Burger", 8000, MenuStatus.ON_SALE)));

    var result = service.list("1", "  burger  ", "default");

    assertThat(result.menus()).extracting(m -> m.id()).containsExactly(1L);
    assertThat(service.list("1", "   ", "default").menus())
        .extracting(m -> m.id())
        .containsExactly(1L, 2L);
    assertThat(service.list("9223372036854775807", null, null).menus()).isEmpty();
  }

  @Test
  void sortsByPriceWithMenuIdAscendingForTies() {
    var category = category(1, 0);
    when(menus.findAllByStatusNot(MenuStatus.HIDDEN))
        .thenReturn(
            List.of(
                menu(8, category, "A", 7000, MenuStatus.ON_SALE),
                menu(4, category, "B", 2000, MenuStatus.ON_SALE),
                menu(2, category, "C", 7000, MenuStatus.PAUSED),
                menu(1, category, "D", 2000, MenuStatus.ON_SALE)));

    assertThat(service.list(null, "", "priceAsc").menus())
        .extracting(m -> m.id())
        .containsExactly(1L, 4L, 2L, 8L);
    assertThat(service.list(null, "", "priceDesc").menus())
        .extracting(m -> m.id())
        .containsExactly(2L, 8L, 1L, 4L);
  }

  @ParameterizedTest
  @ValueSource(strings = {"0", "-1", "1.0", "wrong", "", " 1 ", "9223372036854775808"})
  void rejectsInvalidCategoryIdsBeforeQuerying(String value) {
    assertThatThrownBy(() -> service.list(value, null, null))
        .isInstanceOf(CustomerMenuQueryException.class);
    verifyNoInteractions(categories, menus, options);
  }

  @ParameterizedTest
  @ValueSource(strings = {"", "DEFAULT", "PriceAsc", "random", "priceDesc "})
  void rejectsInvalidSortBeforeQuerying(String value) {
    assertThatThrownBy(() -> service.list(null, null, value))
        .isInstanceOf(CustomerMenuQueryException.class);
    verifyNoInteractions(categories, menus, options);
  }

  @Test
  void returnsPausedDetailsAndAllOptionsSortedWithoutSelectingThem() {
    var category = category(1, 0);
    var menu = menu(5, category, "Menu", 6500, MenuStatus.PAUSED);
    when(menus.findById(5L)).thenReturn(Optional.of(menu));
    when(options.findByMenuIdOrderByIdAsc(5L))
        .thenReturn(List.of(option(9, menu, false, false), option(7, menu, true, true)));

    var result = service.detail("5");

    assertThat(result.status()).isEqualTo(MenuStatus.PAUSED);
    assertThat(result.description()).isNull();
    assertThat(result.imageUrl()).isNull();
    assertThat(result.options()).extracting(o -> o.id()).containsExactly(7L, 9L);
    assertThat(result.options().getFirst().isDefault()).isTrue();
    assertThat(result.options().get(1).active()).isFalse();
    verify(options).findByMenuIdOrderByIdAsc(5L);
  }

  @Test
  void returnsNotFoundForHiddenAndMissingWithoutLoadingOptions() {
    var category = category(1, 0);
    when(menus.findById(1L))
        .thenReturn(Optional.of(menu(1, category, "Hidden", 0, MenuStatus.HIDDEN)));
    when(menus.findById(2L)).thenReturn(Optional.empty());

    assertThatThrownBy(() -> service.detail("1"))
        .isInstanceOf(CustomerMenuNotFoundException.class);
    assertThatThrownBy(() -> service.detail("2"))
        .isInstanceOf(CustomerMenuNotFoundException.class);
    verifyNoInteractions(options);
  }

  @ParameterizedTest
  @ValueSource(strings = {"0", "-1", "1.5", "a", "", "9223372036854775808"})
  void rejectsInvalidMenuIdsBeforeQuerying(String value) {
    assertThatThrownBy(() -> service.detail(value))
        .isInstanceOf(CustomerMenuQueryException.class);
    verifyNoInteractions(categories, menus, options);
  }

  @Test
  void propagatesDatabaseFailureWithoutPretendingMenuIsMissing() {
    when(menus.findById(7L))
        .thenThrow(new DataAccessResourceFailureException("private connection detail"));
    assertThatThrownBy(() -> service.detail("7"))
        .isInstanceOf(DataAccessResourceFailureException.class);
  }
}
