package com.peakorder.menu;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.peakorder.menu.entity.Category;
import com.peakorder.menu.entity.Menu;
import com.peakorder.menu.entity.MenuOption;
import com.peakorder.menu.entity.MenuStatus;
import com.peakorder.menu.exception.AdminMenuQueryException;
import com.peakorder.menu.repository.AdminMenuQueryRepository;
import com.peakorder.menu.repository.CategoryRepository;
import com.peakorder.menu.repository.MenuOptionRepository;
import com.peakorder.menu.repository.MenuRepository;
import com.peakorder.menu.service.AdminMenuQueryService;
import jakarta.persistence.EntityManager;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.annotation.Transactional;

/** Run only with an explicitly configured isolated test database, never a shared development DB. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.NONE)
@EnabledIfEnvironmentVariable(named = "MENU_DB_TEST_URL", matches = "jdbc:postgresql:.+")
@Transactional
class AdminMenuQueryDatabaseTests {
  @Autowired private CategoryRepository categories;
  @Autowired private MenuRepository menus;
  @Autowired private MenuOptionRepository options;
  @Autowired private AdminMenuQueryRepository adminMenus;
  @Autowired private AdminMenuQueryService service;
  @Autowired private EntityManager entityManager;

  @DynamicPropertySource
  static void databaseProperties(DynamicPropertyRegistry registry) {
    registry.add("spring.datasource.url", () -> System.getenv("MENU_DB_TEST_URL"));
    registry.add("spring.datasource.username", () -> System.getenv("MENU_DB_TEST_USERNAME"));
    registry.add("spring.datasource.password", () -> System.getenv("MENU_DB_TEST_PASSWORD"));
  }

  private Menu save(Category category, String name, int price, MenuStatus status) {
    return menus.saveAndFlush(new Menu(category, name, null, null, price, 90, status));
  }

  @Test
  void jpqlIncludesAllStatesAndFetchesCategoryWithoutLazyFollowup() {
    var category = categories.saveAndFlush(new Category("DB category", 0));
    for (var status : MenuStatus.values()) {
      save(category, status.name(), 0, status);
    }
    entityManager.clear();
    var loaded = adminMenus.findAllWithCategory();
    assertThat(loaded).hasSize(3);
    assertThat(loaded).extracting(Menu::getStatus).containsExactlyInAnyOrder(MenuStatus.values());
    for (var menu : loaded) {
      assertThat(
              entityManager
                  .getEntityManagerFactory()
                  .getPersistenceUnitUtil()
                  .isLoaded(menu, "category"))
          .isTrue();
      assertThat(menu.getCategory().getName()).isEqualTo("DB category");
    }
  }

  @ParameterizedTest
  @EnumSource(MenuStatus.class)
  void detailJpqlAndServiceReturnEachStateIncludingHidden(MenuStatus status) {
    var category = categories.saveAndFlush(new Category("Detail", 0));
    var menu = save(category, "Menu", 6500, status);
    entityManager.clear();
    var loaded = adminMenus.findWithCategoryById(menu.getId()).orElseThrow();
    assertThat(loaded.getStatus()).isEqualTo(status);
    assertThat(
            entityManager
                .getEntityManagerFactory()
                .getPersistenceUnitUtil()
                .isLoaded(loaded, "category"))
        .isTrue();
    var result = service.detail(menu.getId());
    assertThat(result.id()).isEqualTo(menu.getId());
    assertThat(result.categoryId()).isEqualTo(category.getId());
    assertThat(result.status()).isEqualTo(status);
    assertThat(result.cookTimeSec()).isEqualTo(90);
    assertThat(result.createdAt()).isNotNull();
    assertThat(result.updatedAt()).isEqualTo(result.createdAt());
    assertThat(result.description()).isNull();
    assertThat(result.imageUrl()).isNull();
    assertThat(result.options()).isEmpty();
  }

  @Test
  void optionJpqlOrdersByIdIncludesInactiveAndExcludesAnotherMenu() {
    var category = categories.saveAndFlush(new Category("Options", 0));
    var hidden = save(category, "Hidden", 0, MenuStatus.HIDDEN);
    var other = save(category, "Other", 0, MenuStatus.ON_SALE);
    var first =
        options.saveAndFlush(new MenuOption(hidden, "Inactive default", 0, 30, true, false));
    options.saveAndFlush(new MenuOption(other, "Foreign", 0, 0, false, true));
    var second = options.saveAndFlush(new MenuOption(hidden, "Active", 100, 0, false, true));
    entityManager.clear();
    assertThat(adminMenus.findOptionsByMenuId(hidden.getId()))
        .extracting(MenuOption::getId)
        .containsExactly(first.getId(), second.getId());
    var result = service.detail(hidden.getId());
    assertThat(result.options())
        .extracting(o -> o.id())
        .containsExactly(first.getId(), second.getId());
    assertThat(result.options().getFirst().isDefault()).isTrue();
    assertThat(result.options().getFirst().active()).isFalse();
    assertThat(result.options().getFirst().extraCookTimeSec()).isEqualTo(30);
    assertThat(result.options().getLast().active()).isTrue();
    assertThat(result.options().getLast().extraPrice()).isEqualTo(100);
  }

  @ParameterizedTest
  @ValueSource(strings = {"default", "priceAsc", "priceDesc"})
  void actualDatabaseRowsUseCategoryAndPriceTieBreakers(String sort) {
    var lateCategory = categories.saveAndFlush(new Category("Late", 10));
    var firstCategory = categories.saveAndFlush(new Category("First", 0));
    var secondCategory = categories.saveAndFlush(new Category("Second", 0));
    var emptyCategory = categories.saveAndFlush(new Category("Empty", 20));
    var late = save(lateCategory, "Late", 100, MenuStatus.ON_SALE);
    var second = save(secondCategory, "Second", 100, MenuStatus.HIDDEN);
    var cheap = save(firstCategory, "Cheap", 0, MenuStatus.PAUSED);
    var first = save(firstCategory, "First", 100, MenuStatus.ON_SALE);
    entityManager.clear();
    var result = service.list(null, null, null, sort);
    assertThat(result.categories())
        .extracting(c -> c.id())
        .containsExactly(
            firstCategory.getId(),
            secondCategory.getId(),
            lateCategory.getId(),
            emptyCategory.getId());
    List<Long> expected =
        switch (sort) {
          case "priceAsc" -> List.of(cheap.getId(), late.getId(), second.getId(), first.getId());
          case "priceDesc" -> List.of(late.getId(), second.getId(), first.getId(), cheap.getId());
          default -> List.of(cheap.getId(), first.getId(), second.getId(), late.getId());
        };
    assertThat(result.menus()).extracting(m -> m.id()).containsExactlyElementsOf(expected);
  }

  @Test
  void combinesCategorySearchAndHiddenFilterWithRealRows() {
    var first = categories.saveAndFlush(new Category("First", 0));
    var second = categories.saveAndFlush(new Category("Second", 0));
    var match = save(first, "Classic BURGER 100%_", 0, MenuStatus.HIDDEN);
    save(first, "Burger", 0, MenuStatus.PAUSED);
    save(second, "Burger", 0, MenuStatus.HIDDEN);
    entityManager.clear();
    assertThat(service.list(first.getId(), "  bUrGeR  ", "HIDDEN", null).menus())
        .extracting(m -> m.id())
        .containsExactly(match.getId());
    assertThat(service.list(null, "%_", null, null).menus())
        .extracting(m -> m.id())
        .containsExactly(match.getId());
    assertThat(service.list(null, "   ", null, null).menus()).hasSize(3);
    assertThat(service.list(null, "no match", null, null).menus()).isEmpty();
    assertThat(service.list(Long.MAX_VALUE, null, null, null).menus()).isEmpty();
    assertThat(service.list(Long.MAX_VALUE, null, null, null).categories()).hasSize(2);
  }

  @ParameterizedTest
  @EnumSource(MenuStatus.class)
  void eachStatusCanBeFilteredAgainstStoredData(MenuStatus status) {
    var category = categories.saveAndFlush(new Category("State filter", 0));
    for (var value : MenuStatus.values()) {
      save(category, value.name(), 0, value);
    }
    entityManager.clear();
    var result = service.list(null, null, status.name(), null);
    assertThat(result.menus()).hasSize(1);
    assertThat(result.menus().getFirst().status()).isEqualTo(status);
  }

  @Test
  void emptyDatabaseAndMissingDetailReturnExpectedResults() {
    assertThat(adminMenus.findAllWithCategory()).isEmpty();
    assertThat(adminMenus.findWithCategoryById(Long.MAX_VALUE)).isEmpty();
    assertThat(adminMenus.findOptionsByMenuId(Long.MAX_VALUE)).isEmpty();
    assertThat(service.list(null, null, null, null).menus()).isEmpty();
    assertThat(service.list(null, null, null, null).categories()).isEmpty();
    assertThatThrownBy(() -> service.detail(Long.MAX_VALUE))
        .isInstanceOfSatisfying(
            AdminMenuQueryException.class,
            failure -> assertThat(failure.errorCode()).isEqualTo("MENU_NOT_FOUND"));
  }
}
