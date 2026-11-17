package com.peakorder.menu;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.peakorder.menu.entity.Category;
import com.peakorder.menu.entity.Menu;
import com.peakorder.menu.entity.MenuOption;
import com.peakorder.menu.entity.MenuStatus;
import com.peakorder.menu.repository.CategoryRepository;
import com.peakorder.menu.repository.MenuOptionRepository;
import com.peakorder.menu.repository.MenuRepository;
import jakarta.persistence.EntityManager;
import java.time.Instant;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.EnumSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.NONE)
@EnabledIfEnvironmentVariable(named = "MENU_DB_TEST_URL", matches = "jdbc:postgresql:.+")
@Transactional
class MenuDatabaseTests {
  @Autowired private CategoryRepository categories;
  @Autowired private MenuRepository menus;
  @Autowired private MenuOptionRepository options;
  @Autowired private EntityManager entityManager;
  @Autowired private JdbcTemplate jdbc;
  @Autowired private Flyway flyway;

  @DynamicPropertySource
  static void databaseProperties(DynamicPropertyRegistry registry) {
    registry.add("spring.datasource.url", () -> System.getenv("MENU_DB_TEST_URL"));
    registry.add("spring.datasource.username", () -> System.getenv("MENU_DB_TEST_USERNAME"));
    registry.add("spring.datasource.password", () -> System.getenv("MENU_DB_TEST_PASSWORD"));
  }

  @Test
  void appliesAndValidatesV1Migration() {
    assertThat(flyway.validateWithResult().validationSuccessful).isTrue();
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM flyway_schema_history WHERE version = '1' AND success",
                Long.class))
        .isEqualTo(1L);
    assertThat(
            jdbc.queryForList(
                "SELECT indexname FROM pg_indexes WHERE schemaname = current_schema() "
                    + "AND indexname IN ('idx_menus_category_id', 'idx_menu_options_menu_id')",
                String.class))
        .containsExactlyInAnyOrder("idx_menus_category_id", "idx_menu_options_menu_id");
  }

  @ParameterizedTest
  @EnumSource(MenuStatus.class)
  void savesAndLoadsEntitiesAndRelationships(MenuStatus status) {
    Instant before = Instant.now().minusSeconds(1);
    var category = categories.saveAndFlush(new Category("버거", 2));
    var menu =
        menus.saveAndFlush(
            new Menu(category, "치즈버거", "메뉴 설명", "https://example.com/menu.png", 5500, 90, status));
    var option = options.saveAndFlush(new MenuOption(menu, "세트", 2000, 30, true, false));
    entityManager.clear();

    var loadedCategory = categories.findById(category.getId()).orElseThrow();
    assertThat(loadedCategory.getName()).isEqualTo("버거");
    assertThat(loadedCategory.getSortOrder()).isEqualTo(2);
    var loadedMenu = menus.findById(menu.getId()).orElseThrow();
    assertThat(loadedMenu.getCategory().getId()).isEqualTo(category.getId());
    assertThat(loadedMenu.getName()).isEqualTo("치즈버거");
    assertThat(loadedMenu.getDescription()).isEqualTo("메뉴 설명");
    assertThat(loadedMenu.getImageUrl()).isEqualTo("https://example.com/menu.png");
    assertThat(loadedMenu.getBasePrice()).isEqualTo(5500);
    assertThat(loadedMenu.getCookTimeSec()).isEqualTo(90);
    assertThat(loadedMenu.getStatus()).isEqualTo(status);
    assertThat(loadedMenu.getCreatedAt()).isAfter(before);
    assertThat(loadedMenu.getUpdatedAt()).isEqualTo(loadedMenu.getCreatedAt());
    var loadedOption = options.findById(option.getId()).orElseThrow();
    assertThat(loadedOption.getMenu().getId()).isEqualTo(menu.getId());
    assertThat(loadedOption.getName()).isEqualTo("세트");
    assertThat(loadedOption.getExtraPrice()).isEqualTo(2000);
    assertThat(loadedOption.getExtraCookTimeSec()).isEqualTo(30);
    assertThat(loadedOption.isDefault()).isTrue();
    assertThat(loadedOption.isActive()).isFalse();
  }

  @Test
  void acceptsZeroPricesAndTimesAndOptionalDetails() {
    var menu = createMenu();
    var option = options.saveAndFlush(new MenuOption(menu, "단품", 0, 0, false, true));
    entityManager.clear();
    var loadedMenu = menus.findById(menu.getId()).orElseThrow();
    assertThat(loadedMenu.getBasePrice()).isZero();
    assertThat(loadedMenu.getCookTimeSec()).isZero();
    assertThat(loadedMenu.getDescription()).isNull();
    assertThat(loadedMenu.getImageUrl()).isNull();
    var loadedOption = options.findById(option.getId()).orElseThrow();
    assertThat(loadedOption.getExtraPrice()).isZero();
    assertThat(loadedOption.getExtraCookTimeSec()).isZero();
    assertThat(loadedOption.isDefault()).isFalse();
    assertThat(loadedOption.isActive()).isTrue();
  }

  @ParameterizedTest
  @CsvSource({
    "menus, base_price, ck_menus_base_price",
    "menus, cook_time_sec, ck_menus_cook_time_sec",
    "menu_options, extra_price, ck_menu_options_extra_price",
    "menu_options, extra_cook_time_sec, ck_menu_options_extra_cook_time_sec"
  })
  void rejectsNegativePricesAndTimes(String table, String column, String constraint) {
    var menu = createMenu();
    options.saveAndFlush(new MenuOption(menu, "단품", 0, 0, true, true));
    assertConstraint("UPDATE " + table + " SET " + column + " = -1", constraint);
  }

  @ParameterizedTest
  @ValueSource(strings = {"SOLD_OUT", "DELETED", "on_sale", ""})
  void rejectsUnsupportedStatus(String status) {
    var menu = createMenu();
    assertThatThrownBy(
            () -> jdbc.update("UPDATE menus SET status = ? WHERE id = ?", status, menu.getId()))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasStackTraceContaining("ck_menus_status");
  }

  @ParameterizedTest
  @CsvSource({
    "categories, name",
    "categories, sort_order",
    "menus, category_id",
    "menus, name",
    "menus, base_price",
    "menus, cook_time_sec",
    "menus, status",
    "menus, created_at",
    "menus, updated_at",
    "menu_options, menu_id",
    "menu_options, name",
    "menu_options, extra_price",
    "menu_options, extra_cook_time_sec",
    "menu_options, is_default",
    "menu_options, active"
  })
  void rejectsNullRequiredColumns(String table, String column) {
    var menu = createMenu();
    options.saveAndFlush(new MenuOption(menu, "단품", 0, 0, true, true));
    assertThatThrownBy(() -> jdbc.update("UPDATE " + table + " SET " + column + " = NULL"))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasStackTraceContaining(column);
  }

  @ParameterizedTest
  @CsvSource({
    "menus, category_id, fk_menus_category",
    "menu_options, menu_id, fk_menu_options_menu"
  })
  void rejectsMissingParent(String table, String column, String constraint) {
    var menu = createMenu();
    options.saveAndFlush(new MenuOption(menu, "단품", 0, 0, true, true));
    assertConstraint("UPDATE " + table + " SET " + column + " = -1", constraint);
  }

  @ParameterizedTest
  @CsvSource({"categories, fk_menus_category", "menus, fk_menu_options_menu"})
  void preventsDeletingReferencedParent(String table, String constraint) {
    var menu = createMenu();
    options.saveAndFlush(new MenuOption(menu, "단품", 0, 0, true, true));
    assertConstraint("DELETE FROM " + table, constraint);
  }

  @ParameterizedTest
  @ValueSource(strings = {"categories", "menus", "menu_options"})
  void rejectsDuplicatePrimaryKeys(String table) {
    var menu = createMenu();
    options.saveAndFlush(new MenuOption(menu, "단품", 0, 0, true, true));
    assertConstraint("INSERT INTO " + table + " SELECT * FROM " + table, table + "_pkey");
  }

  private Menu createMenu() {
    var category = categories.saveAndFlush(new Category("버거", 0));
    return menus.saveAndFlush(new Menu(category, "버거", null, null, 0, 0, MenuStatus.ON_SALE));
  }

  private void assertConstraint(String sql, String constraint) {
    assertThatThrownBy(() -> jdbc.update(sql))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasStackTraceContaining(constraint);
  }
}
