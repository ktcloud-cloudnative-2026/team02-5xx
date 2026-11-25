package com.peakorder.menu;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

import com.peakorder.menu.dto.AdminMenuCreateRequest;
import com.peakorder.menu.entity.*;
import com.peakorder.menu.repository.*;
import com.peakorder.menu.service.*;
import jakarta.persistence.EntityManager;
import java.util.List;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.NONE)
@EnabledIfEnvironmentVariable(named = "MENU_DB_TEST_URL", matches = "jdbc:postgresql:.+")
class AdminMenuCreateDatabaseTests {
  @Autowired AdminMenuCreateService service;
  @Autowired MenuExistenceService existence;
  @Autowired CategoryRepository categories;
  @Autowired MenuRepository menus;
  @MockitoSpyBean MenuOptionRepository options;
  @Autowired PlatformTransactionManager transactionManager;
  @Autowired EntityManager entityManager;
  @Autowired JdbcTemplate jdbc;
  long categoryId;

  @DynamicPropertySource
  static void database(DynamicPropertyRegistry registry) {
    registry.add("spring.datasource.url", () -> System.getenv("MENU_DB_TEST_URL"));
    registry.add("spring.datasource.username", () -> System.getenv("MENU_DB_TEST_USERNAME"));
    registry.add("spring.datasource.password", () -> System.getenv("MENU_DB_TEST_PASSWORD"));
  }

  @BeforeEach
  void category() {
    categoryId = categories.saveAndFlush(new Category("ME05 test", 0)).getId();
  }

  @AfterEach
  void cleanupOwnData() {
    new TransactionTemplate(transactionManager)
        .executeWithoutResult(
            tx -> {
              jdbc.update(
                  "delete from menu_options where menu_id in (select id from menus where category_id = ?)",
                  categoryId);
              jdbc.update("delete from menus where category_id = ?", categoryId);
              jdbc.update("delete from categories where id = ?", categoryId);
            });
  }

  private AdminMenuCreateRequest request(
      MenuStatus state, List<AdminMenuCreateRequest.Option> items) {
    return new AdminMenuCreateRequest(
        categoryId, "버거😀", "설명", null, 0, Integer.MAX_VALUE, state, items);
  }

  @ParameterizedTest
  @EnumSource(MenuStatus.class)
  void commitsMenuAndOptionsInEveryStateWithRealRepositories(MenuStatus status) {
    var result =
        service.create(
            request(
                status,
                List.of(
                    new AdminMenuCreateRequest.Option("기본", 0, 0, true, true),
                    new AdminMenuCreateRequest.Option("비활성", 100, 30, false, false))));
    new TransactionTemplate(transactionManager)
        .executeWithoutResult(
            tx -> {
              var menu = menus.findById(result.menuId()).orElseThrow();
              assertThat(menu.getCategory().getId()).isEqualTo(categoryId);
              assertThat(menu.getStatus()).isEqualTo(status);
              assertThat(menu.getCreatedAt()).isNotNull();
              assertThat(menu.getName()).isEqualTo("버거😀");
              var saved =
                  options.findAll().stream()
                      .filter(o -> o.getMenu().getId().equals(result.menuId()))
                      .toList();
              assertThat(saved).hasSize(2);
              assertThat(saved)
                  .extracting(MenuOption::isActive)
                  .containsExactlyInAnyOrder(true, false);
            });
    assertThat(existence.check(result.menuId()).exists()).isTrue();
  }

  @Test
  void accepts255CodePointNamesAndNoOptions() {
    var input =
        new AdminMenuCreateRequest(
            categoryId,
            "😀".repeat(255),
            null,
            "x".repeat(255),
            Integer.MAX_VALUE,
            0,
            MenuStatus.HIDDEN,
            List.of());
    assertThat(menus.findById(service.create(input).menuId()).orElseThrow().getName())
        .isEqualTo(input.name());
  }

  @Test
  void laterOptionConstraintFailureRollsBackMenuAndEarlierOption() {
    doAnswer(
            call -> {
              List<MenuOption> items = call.getArgument(0);
              entityManager.persist(items.getFirst());
              entityManager.flush();
              ReflectionTestUtils.setField(items.get(1), "extraPrice", -1);
              entityManager.persist(items.get(1));
              entityManager.flush();
              return items;
            })
        .when(options)
        .saveAllAndFlush(any());
    assertThatThrownBy(
            () ->
                service.create(
                    request(
                        MenuStatus.ON_SALE,
                        List.of(
                            new AdminMenuCreateRequest.Option("first", 0, 0, false, true),
                            new AdminMenuCreateRequest.Option("second", 0, 0, false, true)))))
        .isInstanceOf(RuntimeException.class)
        .hasStackTraceContaining("ck_menu_options_extra_price");
    assertThat(
            jdbc.queryForObject(
                "select count(*) from menus where category_id = ?", Long.class, categoryId))
        .isZero();
    assertThat(jdbc.queryForObject("select count(*) from menu_options", Long.class)).isZero();
  }

  @Test
  void missingCategoryDoesNotPersistMenu() {
    var input =
        new AdminMenuCreateRequest(Long.MAX_VALUE, "x", null, null, 0, 0, MenuStatus.ON_SALE, null);
    assertThatThrownBy(() -> service.create(input)).hasMessage("Category not found");
    assertThat(
            jdbc.queryForObject(
                "select count(*) from menus where category_id = ?", Long.class, categoryId))
        .isZero();
  }
}
