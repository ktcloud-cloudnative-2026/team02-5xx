package com.peakorder.menu.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.peakorder.menu.entity.Category;
import com.peakorder.menu.entity.Menu;
import com.peakorder.menu.entity.MenuOption;
import com.peakorder.menu.entity.MenuStatus;
import com.peakorder.menu.exception.AdminMenuQueryException;
import com.peakorder.menu.repository.AdminMenuQueryRepository;
import com.peakorder.menu.repository.CategoryRepository;
import java.time.Instant;
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

class AdminMenuQueryServiceTests {
  private final AdminMenuQueryRepository menus = mock(AdminMenuQueryRepository.class);
  private final CategoryRepository categories = mock(CategoryRepository.class);
  private final AdminMenuQueryService service = new AdminMenuQueryService(menus, categories);

  private Category category(long id, int order) {
    var category = new Category("Category " + id, order);
    ReflectionTestUtils.setField(category, "id", id);
    return category;
  }

  private Menu menu(long id, Category category, String name, int price, MenuStatus status) {
    var menu = new Menu(category, name, null, null, price, 90, status);
    ReflectionTestUtils.setField(menu, "id", id);
    ReflectionTestUtils.setField(menu, "createdAt", Instant.parse("2026-11-01T00:00:00Z"));
    ReflectionTestUtils.setField(menu, "updatedAt", Instant.parse("2026-11-02T00:00:00Z"));
    return menu;
  }

  @Test
  void defaultOrderUsesCategorySortThenCategoryIdThenMenuIdAndIncludesAllStatuses() {
    var first = category(2, 0);
    var second = category(3, 0);
    var last = category(1, 1);
    var empty = category(4, 2);
    when(categories.findAll()).thenReturn(List.of(empty, last, second, first));
    when(menus.findAllWithCategory())
        .thenReturn(
            List.of(
                menu(4, last, "Last", 0, MenuStatus.ON_SALE),
                menu(1, second, "Paused", 0, MenuStatus.PAUSED),
                menu(3, first, "Hidden", 0, MenuStatus.HIDDEN),
                menu(2, first, "First", 0, MenuStatus.ON_SALE)));
    var result = service.list(null, null, null, null);
    assertThat(result.categories()).extracting(c -> c.id()).containsExactly(2L, 3L, 1L, 4L);
    assertThat(result.menus()).extracting(m -> m.id()).containsExactly(2L, 3L, 1L, 4L);
    assertThat(result.menus()).extracting(m -> m.status()).contains(MenuStatus.values());
    assertThat(result.menus().getFirst().cookTimeSec()).isEqualTo(90);
  }

  @ParameterizedTest
  @CsvSource({"priceAsc,2,3,1", "priceDesc,1,2,3"})
  void priceSortAlwaysBreaksTiesByAscendingMenuId(String sort, long a, long b, long c) {
    var category = category(1, 0);
    when(menus.findAllWithCategory())
        .thenReturn(
            List.of(
                menu(3, category, "Three", 0, MenuStatus.HIDDEN),
                menu(1, category, "One", Integer.MAX_VALUE, MenuStatus.ON_SALE),
                menu(2, category, "Two", 0, MenuStatus.PAUSED)));
    assertThat(service.list(null, null, null, sort).menus())
        .extracting(m -> m.id())
        .containsExactly(a, b, c);
  }

  @ParameterizedTest
  @EnumSource(MenuStatus.class)
  void statusFilterCanSelectEachStateIncludingHidden(MenuStatus status) {
    var category = category(1, 0);
    when(menus.findAllWithCategory())
        .thenReturn(
            List.of(
                menu(1, category, "On sale", 0, MenuStatus.ON_SALE),
                menu(2, category, "Paused", 0, MenuStatus.PAUSED),
                menu(3, category, "Hidden", 0, MenuStatus.HIDDEN)));
    var result = service.list(null, null, status.name(), null);
    assertThat(result.menus()).hasSize(1);
    assertThat(result.menus().getFirst().status()).isEqualTo(status);
  }

  @Test
  void combinedFiltersUseTrimmedCaseInsensitiveLiteralSubstringAndKeepAllCategories() {
    var first = category(1, 0);
    var second = category(2, 0);
    when(categories.findAll()).thenReturn(List.of(second, first));
    when(menus.findAllWithCategory())
        .thenReturn(
            List.of(
                menu(1, first, "Classic BURGER 100%_", 0, MenuStatus.HIDDEN),
                menu(2, second, "Burger", 0, MenuStatus.HIDDEN),
                menu(3, first, "Burger", 0, MenuStatus.PAUSED)));
    var result = service.list(1L, "  bUrGeR  ", "HIDDEN", "default");
    assertThat(result.menus()).extracting(m -> m.id()).containsExactly(1L);
    assertThat(result.categories()).hasSize(2);
    assertThat(service.list(null, "%_", null, null).menus())
        .extracting(m -> m.id())
        .containsExactly(1L);
    assertThat(service.list(null, "   ", null, null).menus()).hasSize(3);
    assertThat(service.list(null, "not present", null, null).menus()).isEmpty();
    assertThat(service.list(Long.MAX_VALUE, null, null, null).menus()).isEmpty();
    assertThat(service.list(Long.MAX_VALUE, null, null, null).categories()).hasSize(2);
  }

  @Test
  void emptyDatabaseReturnsEmptyCollections() {
    var result = service.list(null, "", null, null);
    assertThat(result.categories()).isEmpty();
    assertThat(result.menus()).isEmpty();
  }

  @ParameterizedTest
  @ValueSource(longs = {0, -1, Long.MIN_VALUE})
  void rejectsInvalidCategoryBeforeQuerying(long id) {
    assertInvalid(() -> service.list(id, null, null, null));
  }

  @ParameterizedTest
  @ValueSource(strings = {"", "hidden", "ALL", "SOLD_OUT", "ON_SALE,PAUSED", " HIDDEN "})
  void rejectsInvalidStatusBeforeQuerying(String status) {
    assertInvalid(() -> service.list(null, null, status, null));
  }

  @ParameterizedTest
  @ValueSource(strings = {"", "DEFAULT", "price", "priceAsc,priceDesc"})
  void rejectsInvalidSortBeforeQuerying(String sort) {
    assertInvalid(() -> service.list(null, null, null, sort));
  }

  @ParameterizedTest
  @EnumSource(MenuStatus.class)
  void detailReturnsEachStateWithAllOptionFieldsAndTimestamps(MenuStatus status) {
    var menu = menu(1, category(2, 0), "Burger", 6500, status);
    var inactive = new MenuOption(menu, "Inactive default", 0, 30, true, false);
    var active = new MenuOption(menu, "Active", 200, 0, false, true);
    ReflectionTestUtils.setField(inactive, "id", 3L);
    ReflectionTestUtils.setField(active, "id", 4L);
    when(menus.findWithCategoryById(1L)).thenReturn(Optional.of(menu));
    when(menus.findOptionsByMenuId(1L)).thenReturn(List.of(inactive, active));
    var result = service.detail(1L);
    assertThat(result.id()).isEqualTo(1L);
    assertThat(result.categoryId()).isEqualTo(2L);
    assertThat(result.name()).isEqualTo("Burger");
    assertThat(result.description()).isNull();
    assertThat(result.imageUrl()).isNull();
    assertThat(result.status()).isEqualTo(status);
    assertThat(result.basePrice()).isEqualTo(6500);
    assertThat(result.cookTimeSec()).isEqualTo(90);
    assertThat(result.createdAt()).isEqualTo(menu.getCreatedAt());
    assertThat(result.updatedAt()).isEqualTo(menu.getUpdatedAt());
    assertThat(result.options()).extracting(o -> o.id()).containsExactly(3L, 4L);
    assertThat(result.options().getFirst().isDefault()).isTrue();
    assertThat(result.options().getFirst().active()).isFalse();
    assertThat(result.options().getFirst().extraCookTimeSec()).isEqualTo(30);
    assertThat(result.options().getLast().extraPrice()).isEqualTo(200);
    assertThat(result.options().getLast().active()).isTrue();
    assertThat(result.options().getLast().isDefault()).isFalse();
    verifyNoInteractions(categories);
  }

  @Test
  void detailWithoutOptionsReturnsEmptyArray() {
    when(menus.findWithCategoryById(Long.MAX_VALUE))
        .thenReturn(
            Optional.of(menu(Long.MAX_VALUE, category(1, 0), "Hidden", 0, MenuStatus.HIDDEN)));
    assertThat(service.detail(Long.MAX_VALUE).options()).isEmpty();
  }

  @ParameterizedTest
  @NullSource
  @ValueSource(longs = {0, -1, Long.MIN_VALUE})
  void rejectsInvalidDetailIdBeforeQuerying(Long id) {
    assertInvalid(() -> service.detail(id));
  }

  @Test
  void missingDetailHasMenuNotFoundCode() {
    assertThatThrownBy(() -> service.detail(1L))
        .isInstanceOfSatisfying(
            AdminMenuQueryException.class,
            error -> assertThat(error.errorCode()).isEqualTo("MENU_NOT_FOUND"));
  }

  @ParameterizedTest
  @ValueSource(strings = {"categories", "list", "detail", "options"})
  void databaseFailurePropagatesInsteadOfReturningEmptyOrNotFound(String location) {
    var failure = new DataAccessResourceFailureException("private database detail");
    Runnable action;
    switch (location) {
      case "categories" -> {
        when(categories.findAll()).thenThrow(failure);
        action = () -> service.list(null, null, null, null);
      }
      case "list" -> {
        when(menus.findAllWithCategory()).thenThrow(failure);
        action = () -> service.list(null, null, null, null);
      }
      case "detail" -> {
        when(menus.findWithCategoryById(1L)).thenThrow(failure);
        action = () -> service.detail(1L);
      }
      default -> {
        when(menus.findWithCategoryById(1L))
            .thenReturn(Optional.of(menu(1, category(1, 0), "Hidden", 0, MenuStatus.HIDDEN)));
        when(menus.findOptionsByMenuId(1L)).thenThrow(failure);
        action = () -> service.detail(1L);
      }
    }
    assertThatThrownBy(action::run).isSameAs(failure);
  }

  private void assertInvalid(Runnable action) {
    assertThatThrownBy(action::run)
        .isInstanceOfSatisfying(
            AdminMenuQueryException.class,
            error -> assertThat(error.errorCode()).isEqualTo("INVALID_REQUEST"));
    verifyNoInteractions(menus, categories);
  }
}
