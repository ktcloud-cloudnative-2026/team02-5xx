package com.peakorder.menu.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.*;

import com.peakorder.menu.entity.Category;
import com.peakorder.menu.entity.Menu;
import com.peakorder.menu.entity.MenuOption;
import com.peakorder.menu.entity.MenuStatus;
import com.peakorder.menu.exception.CustomerMenuException;
import com.peakorder.menu.repository.CategoryRepository;
import com.peakorder.menu.repository.MenuOptionRepository;
import com.peakorder.menu.repository.MenuRepository;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.EnumSource;
import org.junit.jupiter.params.provider.NullSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.test.util.ReflectionTestUtils;

class CustomerMenuServiceTests {
  private final MenuRepository menus = mock(MenuRepository.class);
  private final CategoryRepository categories = mock(CategoryRepository.class);
  private final MenuOptionRepository options = mock(MenuOptionRepository.class);
  private final CustomerMenuService service = new CustomerMenuService(menus, categories, options);

  private Category category(long id, int order) {
    var result = new Category("Category " + id, order);
    ReflectionTestUtils.setField(result, "id", id);
    return result;
  }

  private Menu menu(long id, Category category, String name, int price, MenuStatus status) {
    var result = new Menu(category, name, null, null, price, 0, status);
    ReflectionTestUtils.setField(result, "id", id);
    return result;
  }

  @Test
  void ordersCategoriesAndMenusByEveryDefaultTieBreaker() {
    var first = category(2, 0);
    var second = category(3, 0);
    var later = category(1, 1);
    when(categories.findAll()).thenReturn(List.of(later, second, first));
    when(menus.findByStatusIn(List.of(MenuStatus.ON_SALE, MenuStatus.PAUSED)))
        .thenReturn(
            List.of(
                menu(1, second, "Paused", 0, MenuStatus.PAUSED),
                menu(3, first, "Third", 0, MenuStatus.ON_SALE),
                menu(2, first, "Second", 0, MenuStatus.ON_SALE),
                menu(4, later, "Later category", 0, MenuStatus.ON_SALE)));
    var result = service.list(null, null, null);
    assertThat(result.categories()).extracting(c -> c.id()).containsExactly(2L, 3L, 1L);
    assertThat(result.menus()).extracting(m -> m.id()).containsExactly(2L, 3L, 1L, 4L);
    assertThat(result.menus().get(2).status()).isEqualTo(MenuStatus.PAUSED);
    verify(menus).findByStatusIn(List.of(MenuStatus.ON_SALE, MenuStatus.PAUSED));
    verifyNoInteractions(options);
  }

  @ParameterizedTest
  @CsvSource({"priceAsc,2,3,1", "priceDesc,1,2,3"})
  void priceSortingKeepsAscendingIdTies(String sort, long one, long two, long three) {
    var category = category(1, 0);
    when(menus.findByStatusIn(any()))
        .thenReturn(
            List.of(
                menu(3, category, "Three", 0, MenuStatus.ON_SALE),
                menu(1, category, "One", 100, MenuStatus.PAUSED),
                menu(2, category, "Two", 0, MenuStatus.ON_SALE)));
    assertThat(service.list(null, null, sort).menus())
        .extracting(m -> m.id())
        .containsExactly(one, two, three);
  }

  @Test
  void combinesCategoryWithTrimmedCaseInsensitiveLiteralNameSearch() {
    var first = category(1, 0);
    var second = category(2, 0);
    when(categories.findAll()).thenReturn(List.of(second, first));
    when(menus.findByStatusIn(any()))
        .thenReturn(
            List.of(
                menu(1, first, "Classic BURGER 100%_", 100, MenuStatus.ON_SALE),
                menu(2, second, "Burger", 100, MenuStatus.PAUSED),
                menu(3, first, "Other", 100, MenuStatus.ON_SALE)));
    assertThat(service.list(1L, "  bUrGeR  ", "default").menus())
        .extracting(m -> m.id())
        .containsExactly(1L);
    assertThat(service.list(null, "%_", null).menus()).extracting(m -> m.id()).containsExactly(1L);
    assertThat(service.list(null, "   ", null).menus()).hasSize(3);
    assertThat(service.list(999L, null, null).menus()).isEmpty();
    assertThat(service.list(999L, "not present", null).categories()).hasSize(2);
  }

  @Test
  void emptyDatabaseReturnsEmptyCollections() {
    assertThat(service.list(null, "", null).menus()).isEmpty();
    assertThat(service.list(null, "", null).categories()).isEmpty();
  }

  @ParameterizedTest
  @ValueSource(longs = {0, -1, Long.MIN_VALUE})
  void invalidCategoryDoesNotQueryDatabase(long id) {
    assertThatThrownBy(() -> service.list(id, null, null))
        .isInstanceOf(CustomerMenuException.class);
    verifyNoInteractions(menus, categories, options);
  }

  @ParameterizedTest
  @ValueSource(strings = {"", "DEFAULT", "invalid", "priceAsc,priceDesc"})
  void invalidSortDoesNotQueryDatabase(String sort) {
    assertThatThrownBy(() -> service.list(null, null, sort))
        .isInstanceOf(CustomerMenuException.class);
    verifyNoInteractions(menus, categories, options);
  }

  @ParameterizedTest
  @EnumSource(
      value = MenuStatus.class,
      names = {"ON_SALE", "PAUSED"})
  void detailIncludesInactiveAndDefaultOptionsWithoutSelectingThem(MenuStatus status) {
    var menu = menu(1, category(2, 0), "Burger", 0, status);
    var inactive = new MenuOption(menu, "Inactive", 0, 0, true, false);
    var active = new MenuOption(menu, "Active", 200, 0, false, true);
    ReflectionTestUtils.setField(inactive, "id", 3L);
    ReflectionTestUtils.setField(active, "id", 4L);
    when(menus.findById(1L)).thenReturn(Optional.of(menu));
    when(options.findByMenuIdOrderByIdAsc(1L)).thenReturn(List.of(inactive, active));
    var result = service.detail(1L);
    assertThat(result.categoryId()).isEqualTo(2L);
    assertThat(result.status()).isEqualTo(status);
    assertThat(result.description()).isNull();
    assertThat(result.imageUrl()).isNull();
    assertThat(result.options()).extracting(o -> o.id()).containsExactly(3L, 4L);
    assertThat(result.options().getFirst().isDefault()).isTrue();
    assertThat(result.options().getFirst().active()).isFalse();
    assertThat(result.options().getLast().extraPrice()).isEqualTo(200);
    verifyNoInteractions(categories);
  }

  @ParameterizedTest
  @ValueSource(booleans = {true, false})
  void hiddenAndMissingAreIndistinguishableAndNeverLoadOptions(boolean hidden) {
    when(menus.findById(1L))
        .thenReturn(
            hidden
                ? Optional.of(menu(1, category(1, 0), "Secret", 0, MenuStatus.HIDDEN))
                : Optional.empty());
    assertThatThrownBy(() -> service.detail(1L))
        .isInstanceOf(CustomerMenuException.class)
        .hasMessage("Menu not found");
    verifyNoInteractions(options, categories);
  }

  @ParameterizedTest
  @NullSource
  @ValueSource(longs = {0, -1, Long.MIN_VALUE})
  void invalidDetailIdDoesNotQueryDatabase(Long id) {
    assertThatThrownBy(() -> service.detail(id)).isInstanceOf(CustomerMenuException.class);
    verifyNoInteractions(menus, categories, options);
  }

  @Test
  void repositoryFailuresAreNotReportedAsEmptyOrMissingResults() {
    var failure = new DataAccessResourceFailureException("private SQL detail");
    when(categories.findAll()).thenThrow(failure);
    assertThatThrownBy(() -> service.list(null, null, null)).isSameAs(failure);
    when(menus.findById(1L)).thenThrow(failure);
    assertThatThrownBy(() -> service.detail(1L)).isSameAs(failure);
  }
}
