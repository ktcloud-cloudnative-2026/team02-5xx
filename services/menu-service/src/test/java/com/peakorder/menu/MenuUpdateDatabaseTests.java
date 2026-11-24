package com.peakorder.menu;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.peakorder.menu.dto.MenuUpdateRequest;
import com.peakorder.menu.entity.*;
import com.peakorder.menu.repository.*;
import com.peakorder.menu.service.MenuUpdateService;
import jakarta.persistence.EntityManager;
import java.time.Instant;
import java.util.List;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.ObjectMapper;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.NONE)
@EnabledIfEnvironmentVariable(named = "MENU_DB_TEST_URL", matches = "jdbc:postgresql:.+")
class MenuUpdateDatabaseTests {
  @Autowired MenuUpdateService service;
  @Autowired CategoryRepository categories;
  @Autowired MenuRepository menus;
  @MockitoSpyBean MenuOptionRepository options;
  @Autowired PlatformTransactionManager transactionManager;
  @Autowired EntityManager em;
  @Autowired JdbcTemplate jdbc;
  private final ObjectMapper mapper = new ObjectMapper();
  private long categoryId, secondCategoryId, menuId, optionId, untouchedId;

  private MenuUpdateRequest patch(String json) throws Exception {
    return MenuUpdateRequest.parse(mapper.readTree(json));
  }

  @DynamicPropertySource
  static void database(DynamicPropertyRegistry r) {
    r.add("spring.datasource.url", () -> System.getenv("MENU_DB_TEST_URL"));
    r.add("spring.datasource.username", () -> System.getenv("MENU_DB_TEST_USERNAME"));
    r.add("spring.datasource.password", () -> System.getenv("MENU_DB_TEST_PASSWORD"));
  }

  @BeforeEach
  void fixture() {
    categoryId = categories.saveAndFlush(new Category("old category", 0)).getId();
    secondCategoryId = categories.saveAndFlush(new Category("new category", 1)).getId();
    var menu =
        menus.saveAndFlush(
            new Menu(
                categories.findById(categoryId).orElseThrow(),
                "old",
                "description",
                "image",
                10,
                20,
                MenuStatus.HIDDEN));
    menuId = menu.getId();
    optionId = options.saveAndFlush(new MenuOption(menu, "old option", 3, 4, true, true)).getId();
    untouchedId =
        options.saveAndFlush(new MenuOption(menu, "untouched", 7, 8, false, true)).getId();
    // Give the existing row a deterministic older timestamp; no waiting or schema changes.
    jdbc.update(
        "update menus set updated_at = created_at - interval '1 second' where id = ?", menuId);
  }

  @AfterEach
  void removeOwnFixtures() {
    new TransactionTemplate(transactionManager)
        .executeWithoutResult(
            tx -> {
              jdbc.update(
                  "delete from menu_options where menu_id in (select id from menus where category_id in (?,?))",
                  categoryId,
                  secondCategoryId);
              jdbc.update(
                  "delete from menus where category_id in (?,?)", categoryId, secondCategoryId);
              jdbc.update("delete from categories where id in (?,?)", categoryId, secondCategoryId);
            });
  }

  @ParameterizedTest
  @ValueSource(
      strings = {"name", "categoryId", "description", "imageUrl", "basePrice", "cookTimeSec"})
  void updatesEachFieldPreservingOmittedValuesAndIdentity(String key) throws Exception {
    var before = menus.findById(menuId).orElseThrow();
    String value =
        switch (key) {
          case "categoryId" -> Long.toString(secondCategoryId);
          case "basePrice", "cookTimeSec" -> "0";
          default -> "\"new\"";
        };
    service.update(menuId, patch("{\"" + key + "\":" + value + "}"));
    var after = menus.findById(menuId).orElseThrow();
    assertThat(after.getId()).isEqualTo(menuId);
    assertThat(after.getCreatedAt()).isEqualTo(before.getCreatedAt());
    assertThat(after.getUpdatedAt()).isAfter(before.getUpdatedAt());
    assertThat(after.getStatus()).isEqualTo(MenuStatus.HIDDEN);
    assertThat(after.getName()).isEqualTo(key.equals("name") ? "new" : "old");
    assertThat(after.getDescription()).isEqualTo(key.equals("description") ? "new" : "description");
    assertThat(after.getImageUrl()).isEqualTo(key.equals("imageUrl") ? "new" : "image");
    assertThat(after.getBasePrice()).isEqualTo(key.equals("basePrice") ? 0 : 10);
    assertThat(after.getCookTimeSec()).isEqualTo(key.equals("cookTimeSec") ? 0 : 20);
    assertThat(jdbc.queryForObject("select category_id from menus where id=?", Long.class, menuId))
        .isEqualTo(key.equals("categoryId") ? secondCategoryId : categoryId);
    assertThat(options.count()).isEqualTo(2);
  }

  @Test
  void explicitNullClearsOnlyNullableFieldsAndAcceptsBoundaryLengths() throws Exception {
    service.update(
        menuId,
        patch(
            "{\"description\":null,\"imageUrl\":null,\"name\":\""
                + "😀".repeat(255)
                + "\",\"basePrice\":2147483647}"));
    var menu = menus.findById(menuId).orElseThrow();
    assertThat(menu.getDescription()).isNull();
    assertThat(menu.getImageUrl()).isNull();
    assertThat(menu.getName()).isEqualTo("😀".repeat(255));
    assertThat(menu.getBasePrice()).isEqualTo(Integer.MAX_VALUE);
  }

  @Test
  void updatesAddsAndDeactivatesOptionsWithoutDeletingOrReissuingIds() throws Exception {
    var before = menus.findById(menuId).orElseThrow();
    service.update(
        menuId,
        patch(
            "{\"options\":[{\"optionId\":"
                + optionId
                + ",\"name\":\"edited\",\"extraPrice\":0,\"extraCookTimeSec\":9,\"isDefault\":false,\"active\":false},{\"name\":\"new\",\"extraPrice\":0,\"extraCookTimeSec\":0}]}"));
    var edited = options.findById(optionId).orElseThrow();
    assertThat(edited.getId()).isEqualTo(optionId);
    assertThat(edited.getName()).isEqualTo("edited");
    assertThat(edited.getExtraPrice()).isZero();
    assertThat(edited.getExtraCookTimeSec()).isEqualTo(9);
    assertThat(edited.isDefault()).isFalse();
    assertThat(edited.isActive()).isFalse();
    assertThat(options.findById(untouchedId).orElseThrow().getName()).isEqualTo("untouched");
    var added =
        options.findAll().stream()
            .filter(o -> o.getId() != optionId && o.getId() != untouchedId)
            .findFirst()
            .orElseThrow();
    assertThat(added.getId()).isNotIn(optionId, untouchedId);
    assertThat(added.isDefault()).isFalse();
    assertThat(added.isActive()).isTrue();
    assertThat(options.count()).isEqualTo(3);
    assertThat(menus.findById(menuId).orElseThrow().getUpdatedAt()).isAfter(before.getUpdatedAt());
  }

  @Test
  void omittedOptionsAndEmptyArrayPreserveExistingOptions() throws Exception {
    service.update(menuId, patch("{\"name\":\"changed\",\"options\":[]}"));
    assertThat(options.count()).isEqualTo(2);
    assertThat(options.findById(optionId).orElseThrow().isDefault()).isTrue();
    service.update(
        menuId, patch("{\"options\":[{\"optionId\":" + optionId + ",\"active\":false}]}"));
    assertThat(options.findById(optionId).orElseThrow().getExtraPrice()).isEqualTo(3);
    assertThat(options.findById(optionId).orElseThrow().isDefault()).isTrue();
  }

  @Test
  void foreignAndMissingReferencesDoNotChangeExistingData() throws Exception {
    var other =
        menus.saveAndFlush(
            new Menu(
                categories.findById(categoryId).orElseThrow(),
                "other",
                null,
                null,
                0,
                0,
                MenuStatus.ON_SALE));
    var foreign = options.saveAndFlush(new MenuOption(other, "foreign", 0, 0, false, true));
    for (String json :
        List.of(
            "{\"name\":\"bad\",\"categoryId\":9223372036854775807}",
            "{\"name\":\"bad\",\"options\":[{\"optionId\":9223372036854775807,\"active\":false}]}",
            "{\"name\":\"bad\",\"options\":[{\"optionId\":"
                + foreign.getId()
                + ",\"active\":false}]}")) {
      var request = patch(json);
      assertThatThrownBy(() -> service.update(menuId, request))
          .isInstanceOf(com.peakorder.menu.exception.MenuUpdateException.class);
      assertThat(menus.findById(menuId).orElseThrow().getName()).isEqualTo("old");
    }
    assertThat(options.findById(foreign.getId()).orElseThrow().isActive()).isTrue();
    var request = patch("{\"name\":\"bad\"}");
    assertThatThrownBy(() -> service.update(Long.MAX_VALUE, request)).hasMessage("Menu not found");
  }

  @Test
  void actualLateCheckFailureRollsBackParentExistingOptionAndNewOption() throws Exception {
    Instant timestamp = menus.findById(menuId).orElseThrow().getUpdatedAt();
    doAnswer(
            call -> {
              List<MenuOption> items = call.getArgument(0);
              em.flush(); // parent and existing option updates reach PostgreSQL first
              var added = items.get(1);
              ReflectionTestUtils.setField(added, "extraPrice", -1);
              em.persist(added);
              em.flush();
              return items;
            })
        .when(options)
        .saveAllAndFlush(any());
    var request =
        patch(
            "{\"name\":\"changed\",\"options\":[{\"optionId\":"
                + optionId
                + ",\"active\":false},{\"name\":\"new\",\"extraPrice\":0,\"extraCookTimeSec\":0}]}");
    assertThatThrownBy(() -> service.update(menuId, request))
        .hasStackTraceContaining("ck_menu_options_extra_price");
    var after = menus.findById(menuId).orElseThrow();
    assertThat(after.getName()).isEqualTo("old");
    assertThat(after.getUpdatedAt()).isEqualTo(timestamp);
    assertThat(options.findById(optionId).orElseThrow().isActive()).isTrue();
    assertThat(options.count()).isEqualTo(2);
  }

  @Test
  void concurrentPartialUpdatesSerializeAndRetainBothChanges() throws Exception {
    var tx = new TransactionTemplate(transactionManager);
    var locked = new CountDownLatch(1);
    var release = new CountDownLatch(1);
    var firstPatch = patch("{\"name\":\"concurrent\"}");
    var secondPatch = patch("{\"basePrice\":99}");
    try (var pool = Executors.newFixedThreadPool(2)) {
      var first =
          pool.submit(
              () ->
                  tx.execute(
                      status -> {
                        service.update(menuId, firstPatch);
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
        var second = pool.submit(() -> service.update(menuId, secondPatch));
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
    var result = menus.findById(menuId).orElseThrow();
    assertThat(result.getName()).isEqualTo("concurrent");
    assertThat(result.getBasePrice()).isEqualTo(99);
    assertThat(result.getStatus()).isEqualTo(MenuStatus.HIDDEN);
  }
}
