package com.peakorder.menu;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.peakorder.menu.dto.*;
import com.peakorder.menu.entity.*;
import com.peakorder.menu.repository.*;
import com.peakorder.menu.service.*;
import java.util.List;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.NONE)
@EnabledIfEnvironmentVariable(named = "MENU_DB_TEST_URL", matches = "jdbc:postgresql:.+")
class MenuStatusDatabaseTests {
  @Autowired MenuStatusService service;
  @Autowired MenuExistenceService existence;
  @Autowired PurchaseValidationService purchase;
  @Autowired CategoryRepository categories;
  @Autowired MenuRepository menus;
  @Autowired MenuOptionRepository options;
  @MockitoSpyBean MenuStatusRepository writes;
  @Autowired JdbcTemplate jdbc;
  @Autowired PlatformTransactionManager transactionManager;
  long categoryId, menuId, optionId;

  @DynamicPropertySource
  static void database(DynamicPropertyRegistry r) {
    r.add("spring.datasource.url", () -> System.getenv("MENU_DB_TEST_URL"));
    r.add("spring.datasource.username", () -> System.getenv("MENU_DB_TEST_USERNAME"));
    r.add("spring.datasource.password", () -> System.getenv("MENU_DB_TEST_PASSWORD"));
  }

  @BeforeEach
  void fixture() {
    var category = categories.saveAndFlush(new Category("category", 0));
    categoryId = category.getId();
    var menu =
        menus.saveAndFlush(
            new Menu(category, "name", "description", "image", 10, 20, MenuStatus.ON_SALE));
    menuId = menu.getId();
    optionId = options.saveAndFlush(new MenuOption(menu, "option", 3, 4, true, true)).getId();
    jdbc.update("update menus set updated_at='2000-01-01T00:00:00Z' where id=?", menuId);
  }

  @AfterEach
  void cleanup() {
    new TransactionTemplate(transactionManager)
        .executeWithoutResult(
            tx -> {
              jdbc.update("delete from menu_options where menu_id=?", menuId);
              jdbc.update("delete from menus where id=?", menuId);
              jdbc.update("delete from categories where id=?", categoryId);
            });
  }

  private java.util.Map<String, Object> preserved() {
    return jdbc.queryForMap(
        "select id,category_id,name,description,image_url,base_price,cook_time_sec,created_at from menus where id=?",
        menuId);
  }

  @ParameterizedTest
  @CsvSource({
    "ON_SALE,ON_SALE",
    "ON_SALE,PAUSED",
    "ON_SALE,HIDDEN",
    "PAUSED,ON_SALE",
    "PAUSED,PAUSED",
    "PAUSED,HIDDEN",
    "HIDDEN,ON_SALE",
    "HIDDEN,PAUSED",
    "HIDDEN,HIDDEN"
  })
  void everyTransitionAndRepeatPreservesInformation(MenuStatus from, MenuStatus to) {
    jdbc.update("update menus set status=? where id=?", from.name(), menuId);
    var before = preserved();
    var optionBefore = jdbc.queryForMap("select * from menu_options where id=?", optionId);
    var timestamp = menus.findById(menuId).orElseThrow().getUpdatedAt();
    var result = service.change(menuId, new MenuStatusRequest(to));
    assertThat(result.menuId()).isEqualTo(menuId);
    assertThat(result.status()).isEqualTo(to);
    var after = menus.findById(menuId).orElseThrow();
    assertThat(after.getStatus()).isEqualTo(to);
    if (from == to) assertThat(after.getUpdatedAt()).isEqualTo(timestamp);
    else assertThat(after.getUpdatedAt()).isAfter(timestamp);
    assertThat(preserved()).isEqualTo(before);
    assertThat(jdbc.queryForMap("select * from menu_options where id=?", optionId))
        .isEqualTo(optionBefore);
    service.change(menuId, new MenuStatusRequest(to));
    assertThat(menus.findById(menuId).orElseThrow().getUpdatedAt()).isEqualTo(after.getUpdatedAt());
  }

  @ParameterizedTest
  @EnumSource(MenuStatus.class)
  void changedStatesAgreeWithActualMi01AndMi02(MenuStatus state) {
    service.change(menuId, new MenuStatusRequest(state));
    assertThat(existence.check(menuId).status()).isEqualTo(state);
    assertThat(existence.check(menuId).exists()).isTrue();
    var request =
        new ValidatePurchaseRequest(
            List.of(new ValidatePurchaseRequest.Item(menuId, 1, List.of(optionId))));
    if (state == MenuStatus.ON_SALE) assertThat(purchase.validate(request).items()).hasSize(1);
    else
      assertThatThrownBy(() -> purchase.validate(request))
          .isInstanceOf(com.peakorder.menu.exception.PurchaseValidationException.class);
  }

  @Test
  void missingMenuDoesNotChangeOtherRows() {
    var before = preserved();
    assertThatThrownBy(
            () -> service.change(Long.MAX_VALUE, new MenuStatusRequest(MenuStatus.HIDDEN)))
        .hasMessage("Menu not found");
    assertThat(preserved()).isEqualTo(before);
    assertThat(menus.findById(menuId).orElseThrow().getStatus()).isEqualTo(MenuStatus.ON_SALE);
  }

  @Test
  void failureAfterRealWriteRollsBackStatusAndTimestamp() {
    var before = jdbc.queryForMap("select * from menus where id=?", menuId);
    doAnswer(
            call -> {
              jdbc.update(
                  "update menus set status='HIDDEN',updated_at=clock_timestamp() where id=?",
                  menuId);
              throw new DataAccessResourceFailureException("injected after DB write");
            })
        .when(writes)
        .changeIfDifferent(menuId, "HIDDEN");
    assertThatThrownBy(() -> service.change(menuId, new MenuStatusRequest(MenuStatus.HIDDEN)))
        .isInstanceOf(DataAccessResourceFailureException.class);
    assertThat(jdbc.queryForMap("select * from menus where id=?", menuId)).isEqualTo(before);
    assertThat(options.count()).isEqualTo(1);
  }

  @Test
  void updateTimestampCannotMoveBackwards() {
    jdbc.update("update menus set updated_at='2099-01-01T00:00:00Z' where id=?", menuId);
    var before = menus.findById(menuId).orElseThrow().getUpdatedAt();
    service.change(menuId, new MenuStatusRequest(MenuStatus.PAUSED));
    assertThat(menus.findById(menuId).orElseThrow().getUpdatedAt()).isEqualTo(before);
  }

  @Test
  void concurrentStatusRequestsWaitAndLastWriteWins() throws Exception {
    concurrent(
        () -> service.change(menuId, new MenuStatusRequest(MenuStatus.PAUSED)),
        () -> service.change(menuId, new MenuStatusRequest(MenuStatus.HIDDEN)));
    assertThat(menus.findById(menuId).orElseThrow().getStatus()).isEqualTo(MenuStatus.HIDDEN);
    assertThat(menus.findById(menuId).orElseThrow().getName()).isEqualTo("name");
  }

  @ParameterizedTest
  @ValueSource(booleans = {true, false})
  void narrowStatusUpdateComposesWithLockThenReadInformationWriter(boolean statusFirst)
      throws Exception {
    // Representative DB writer, not the unmerged ME-06 implementation.
    Runnable information =
        () -> {
          var row = jdbc.queryForMap("select status from menus where id=? for update", menuId);
          jdbc.update(
              "update menus set name='edited',base_price=99,status=?,updated_at=clock_timestamp() where id=?",
              row.get("status"),
              menuId);
        };
    Runnable status = () -> service.change(menuId, new MenuStatusRequest(MenuStatus.PAUSED));
    concurrent(statusFirst ? status : information, statusFirst ? information : status);
    var result = menus.findById(menuId).orElseThrow();
    assertThat(result.getName()).isEqualTo("edited");
    assertThat(result.getBasePrice()).isEqualTo(99);
    assertThat(result.getStatus()).isEqualTo(MenuStatus.PAUSED);
    assertThat(options.findById(optionId).orElseThrow().isActive()).isTrue();
  }

  private void concurrent(Runnable firstAction, Runnable secondAction) throws Exception {
    var tx = new TransactionTemplate(transactionManager);
    var locked = new CountDownLatch(1);
    var release = new CountDownLatch(1);
    try (var pool = Executors.newFixedThreadPool(2)) {
      var first =
          pool.submit(
              () ->
                  tx.execute(
                      status -> {
                        firstAction.run();
                        locked.countDown();
                        try {
                          if (!release.await(10, TimeUnit.SECONDS))
                            throw new IllegalStateException("release timeout");
                        } catch (InterruptedException e) {
                          Thread.currentThread().interrupt();
                          throw new IllegalStateException(e);
                        }
                        return null;
                      }));
      try {
        assertThat(locked.await(5, TimeUnit.SECONDS)).isTrue();
        var second =
            pool.submit(
                () ->
                    tx.execute(
                        status -> {
                          secondAction.run();
                          return null;
                        }));
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
        boolean waiting = false;
        while (System.nanoTime() < deadline) {
          waiting =
              Boolean.TRUE.equals(
                  jdbc.queryForObject(
                      "select exists(select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and pid<>pg_backend_pid())",
                      Boolean.class));
          if (waiting) break;
          Thread.sleep(10);
        }
        assertThat(waiting).isTrue();
        release.countDown();
        first.get(5, TimeUnit.SECONDS);
        second.get(5, TimeUnit.SECONDS);
      } finally {
        release.countDown();
      }
    }
  }
}
