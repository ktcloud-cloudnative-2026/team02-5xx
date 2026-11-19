package com.peakorder.menu.service;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

import com.peakorder.menu.dto.MenuUpdateRequest;
import com.peakorder.menu.entity.*;
import com.peakorder.menu.exception.MenuUpdateException;
import com.peakorder.menu.repository.*;
import java.util.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.*;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.test.util.ReflectionTestUtils;
import tools.jackson.databind.ObjectMapper;

class MenuUpdateServiceTests {
  private final MenuRepository menus = mock(MenuRepository.class);
  private final MenuOptionRepository options = mock(MenuOptionRepository.class);
  private final CategoryRepository categories = mock(CategoryRepository.class);
  private final MenuUpdateService service = new MenuUpdateService(menus, options, categories);
  private Menu menu;

  private MenuUpdateRequest patch(String json) throws Exception {
    return MenuUpdateRequest.parse(new ObjectMapper().readTree(json));
  }

  @BeforeEach
  void setup() {
    menu =
        new Menu(new Category("old", 0), "old", "description", "image", 10, 20, MenuStatus.HIDDEN);
    ReflectionTestUtils.setField(menu, "id", 1L);
    when(menus.findForInformationUpdate(1L)).thenReturn(Optional.of(menu));
  }

  @Test
  void modifiesOnlySpecifiedInformationAndKeepsState() throws Exception {
    assertThat(service.update(1L, patch("{\"basePrice\":0,\"description\":null}")).menuId())
        .isEqualTo(1);
    assertThat(menu.getBasePrice()).isZero();
    assertThat(menu.getDescription()).isNull();
    assertThat(menu.getName()).isEqualTo("old");
    assertThat(menu.getImageUrl()).isEqualTo("image");
    assertThat(menu.getStatus()).isEqualTo(MenuStatus.HIDDEN);
    verifyNoInteractions(categories, options);
    verify(menus).flush();
  }

  @Test
  void editsOwnedOptionWithoutChangingIdOrOmittedFlags() throws Exception {
    var option = new MenuOption(menu, "old", 5, 6, true, true);
    ReflectionTestUtils.setField(option, "id", 7L);
    when(options.findById(7L)).thenReturn(Optional.of(option));
    service.update(1L, patch("{\"options\":[{\"optionId\":7,\"active\":false}]}"));
    assertThat(option.getId()).isEqualTo(7);
    assertThat(option.getName()).isEqualTo("old");
    assertThat(option.getExtraPrice()).isEqualTo(5);
    assertThat(option.isDefault()).isTrue();
    assertThat(option.isActive()).isFalse();
    verify(options).saveAllAndFlush(List.of(option));
  }

  @Test
  void addsOptionWithDefaultsWithoutDeletingOthers() throws Exception {
    service.update(
        1L, patch("{\"options\":[{\"name\":\"new\",\"extraPrice\":0,\"extraCookTimeSec\":0}]}"));
    verify(options)
        .saveAllAndFlush(
            argThat(
                items -> {
                  var o = ((List<MenuOption>) items).getFirst();
                  return o.getId() == null && o.getMenu() == menu && !o.isDefault() && o.isActive();
                }));
    verify(options, never()).deleteAll();
  }

  @ParameterizedTest
  @NullSource
  @ValueSource(longs = {0, -1})
  void invalidIdHasNoDatabaseEffects(Long id) throws Exception {
    var request = patch("{\"name\":\"x\"}");
    assertThatThrownBy(() -> service.update(id, request)).isInstanceOf(MenuUpdateException.class);
    verifyNoInteractions(menus, options, categories);
  }

  @Test
  void missingMenuIs404() throws Exception {
    var request = patch("{\"name\":\"x\"}");
    assertThatThrownBy(() -> service.update(2L, request)).hasMessage("Menu not found");
    verifyNoInteractions(categories, options);
  }

  @Test
  void resolvesAllOptionReferencesBeforeMutation() throws Exception {
    var request =
        patch(
            "{\"name\":\"changed\",\"options\":[{\"name\":\"new\",\"extraPrice\":0,\"extraCookTimeSec\":0},{\"optionId\":99,\"active\":false}]}");
    assertThatThrownBy(() -> service.update(1L, request)).hasMessage("Option not found for menu");
    assertThat(menu.getName()).isEqualTo("old");
    verify(options, never()).saveAllAndFlush(any());
    verify(menus, never()).flush();
  }

  @Test
  void rejectsForeignOptionAndMissingCategory() throws Exception {
    var foreign =
        new MenuOption(
            new Menu(new Category("other", 0), "other", null, null, 1, 1, MenuStatus.ON_SALE),
            "x",
            0,
            0,
            false,
            true);
    when(options.findById(5L)).thenReturn(Optional.of(foreign));
    var optionRequest = patch("{\"options\":[{\"optionId\":5,\"active\":false}]}");
    assertThatThrownBy(() -> service.update(1L, optionRequest))
        .hasMessage("Option not found for menu");
    var categoryRequest = patch("{\"name\":\"changed\",\"categoryId\":99}");
    assertThatThrownBy(() -> service.update(1L, categoryRequest)).hasMessage("Category not found");
    assertThat(menu.getName()).isEqualTo("old");
  }

  @Test
  void propagatesStorageFailureForTransactionRollback() throws Exception {
    doThrow(new DataAccessResourceFailureException("private")).when(menus).flush();
    var request = patch("{\"name\":\"x\"}");
    assertThatThrownBy(() -> service.update(1L, request))
        .isInstanceOf(DataAccessResourceFailureException.class);
  }
}
