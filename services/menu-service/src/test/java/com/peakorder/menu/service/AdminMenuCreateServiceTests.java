package com.peakorder.menu.service;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

import com.peakorder.menu.dto.AdminMenuCreateRequest;
import com.peakorder.menu.entity.*;
import com.peakorder.menu.exception.MenuCreateException;
import com.peakorder.menu.repository.*;
import java.util.*;
import java.util.stream.Stream;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.*;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.test.util.ReflectionTestUtils;

class AdminMenuCreateServiceTests {
  private final CategoryRepository categories = mock(CategoryRepository.class);
  private final MenuRepository menus = mock(MenuRepository.class);
  private final MenuOptionRepository options = mock(MenuOptionRepository.class);
  private final AdminMenuCreateService service =
      new AdminMenuCreateService(categories, menus, options);

  static AdminMenuCreateRequest request(
      Long category,
      String name,
      String image,
      Integer price,
      Integer time,
      MenuStatus status,
      List<AdminMenuCreateRequest.Option> options) {
    return new AdminMenuCreateRequest(category, name, null, image, price, time, status, options);
  }

  @BeforeEach
  void setUp() {
    when(categories.findById(1L)).thenReturn(Optional.of(new Category("Food", 0)));
    when(menus.saveAndFlush(any()))
        .thenAnswer(
            invocation -> {
              Menu menu = invocation.getArgument(0);
              ReflectionTestUtils.setField(menu, "id", 7L);
              return menu;
            });
  }

  @ParameterizedTest
  @EnumSource(MenuStatus.class)
  void createsEveryStateWithZeroPricesAndNoOptions(MenuStatus state) {
    assertThat(service.create(request(1L, "x", null, 0, 0, state, null)).menuId()).isEqualTo(7);
    verifyNoInteractions(options);
  }

  @Test
  void savesOptionsWithDefaultsAndExplicitFlags() {
    service.create(
        request(
            1L,
            "x",
            null,
            1,
            1,
            MenuStatus.PAUSED,
            List.of(
                new AdminMenuCreateRequest.Option("a", 0, 0, null, null),
                new AdminMenuCreateRequest.Option("b", 2, 3, true, false))));
    verify(options)
        .saveAllAndFlush(
            argThat(
                values -> {
                  var saved = (List<MenuOption>) values;
                  return saved.size() == 2
                      && saved.get(0).getMenu().getId() == 7L
                      && !saved.get(0).isDefault()
                      && saved.get(0).isActive()
                      && saved.get(1).isDefault()
                      && !saved.get(1).isActive()
                      && saved.get(1).getExtraCookTimeSec() == 3;
                }));
  }

  static Stream<AdminMenuCreateRequest> invalidRequests() {
    return Stream.of(
        null,
        request(null, "x", null, 0, 0, MenuStatus.ON_SALE, null),
        request(0L, "x", null, 0, 0, MenuStatus.ON_SALE, null),
        request(-1L, "x", null, 0, 0, MenuStatus.ON_SALE, null),
        request(1L, null, null, 0, 0, MenuStatus.ON_SALE, null),
        request(1L, " \t", null, 0, 0, MenuStatus.ON_SALE, null),
        request(1L, "x".repeat(256), null, 0, 0, MenuStatus.ON_SALE, null),
        request(1L, "x", "a".repeat(256), 0, 0, MenuStatus.ON_SALE, null),
        request(1L, "x", null, null, 0, MenuStatus.ON_SALE, null),
        request(1L, "x", null, -1, 0, MenuStatus.ON_SALE, null),
        request(1L, "x", null, 0, null, MenuStatus.ON_SALE, null),
        request(1L, "x", null, 0, -1, MenuStatus.ON_SALE, null),
        request(1L, "x", null, 0, 0, null, null),
        request(
            1L,
            "x",
            null,
            0,
            0,
            MenuStatus.ON_SALE,
            Arrays.asList((AdminMenuCreateRequest.Option) null)),
        request(
            1L,
            "x",
            null,
            0,
            0,
            MenuStatus.ON_SALE,
            List.of(new AdminMenuCreateRequest.Option("", 0, 0, false, true))),
        request(
            1L,
            "x",
            null,
            0,
            0,
            MenuStatus.ON_SALE,
            List.of(new AdminMenuCreateRequest.Option("a", -1, 0, false, true))),
        request(
            1L,
            "x",
            null,
            0,
            0,
            MenuStatus.ON_SALE,
            List.of(new AdminMenuCreateRequest.Option("a", 0, -1, false, true))));
  }

  @ParameterizedTest
  @MethodSource("invalidRequests")
  void validatesEntireRequestBeforeDatabaseAccess(AdminMenuCreateRequest request) {
    assertThatThrownBy(() -> service.create(request))
        .isInstanceOf(MenuCreateException.class)
        .extracting(e -> ((MenuCreateException) e).code())
        .isEqualTo("INVALID_REQUEST");
    verifyNoInteractions(categories, menus, options);
  }

  @Test
  void missingCategoryDoesNotWriteAnything() {
    assertThatThrownBy(() -> service.create(request(2L, "x", null, 0, 0, MenuStatus.ON_SALE, null)))
        .isInstanceOf(MenuCreateException.class)
        .extracting(e -> ((MenuCreateException) e).code())
        .isEqualTo("CATEGORY_NOT_FOUND");
    verifyNoInteractions(menus, options);
  }

  @Test
  void rejectsInvalidLaterOptionsAndPostgresqlTextBeforeSaving() {
    var valid = new AdminMenuCreateRequest.Option("first", 0, 0, false, true);
    for (var invalid :
        List.of(
            new AdminMenuCreateRequest.Option("x".repeat(256), 0, 0, false, true),
            new AdminMenuCreateRequest.Option("x", null, 0, false, true),
            new AdminMenuCreateRequest.Option("x", 0, null, false, true),
            new AdminMenuCreateRequest.Option("x\0", 0, 0, false, true))) {
      assertThatThrownBy(
              () ->
                  service.create(
                      request(1L, "x", null, 0, 0, MenuStatus.ON_SALE, List.of(valid, invalid))))
          .isInstanceOf(MenuCreateException.class);
    }
    assertThatThrownBy(
            () ->
                service.create(
                    new AdminMenuCreateRequest(
                        1L, "x", "bad\0text", null, 0, 0, MenuStatus.ON_SALE, null)))
        .isInstanceOf(MenuCreateException.class);
    assertThatThrownBy(
            () -> service.create(request(1L, "x", "bad\0url", 0, 0, MenuStatus.ON_SALE, null)))
        .isInstanceOf(MenuCreateException.class);
    verifyNoInteractions(categories, menus, options);
  }

  @Test
  void propagatesDatabaseFailure() {
    doThrow(new DataAccessResourceFailureException("private")).when(menus).saveAndFlush(any());
    assertThatThrownBy(() -> service.create(request(1L, "x", null, 0, 0, MenuStatus.ON_SALE, null)))
        .isInstanceOf(DataAccessResourceFailureException.class);
  }
}
