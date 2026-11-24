package com.peakorder.menu.service;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.peakorder.menu.dto.MenuStatusRequest;
import com.peakorder.menu.entity.MenuStatus;
import com.peakorder.menu.exception.MenuStatusChangeException;
import com.peakorder.menu.repository.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.*;
import org.springframework.dao.DataAccessResourceFailureException;

class MenuStatusServiceTests {
  private final MenuStatusRepository writes = mock(MenuStatusRepository.class);
  private final MenuRepository menus = mock(MenuRepository.class);
  private final MenuStatusService service = new MenuStatusService(writes, menus);

  @ParameterizedTest
  @EnumSource(MenuStatus.class)
  void changedStatusNeedsNoEntitySnapshot(MenuStatus state) {
    when(writes.changeIfDifferent(1L, state.name())).thenReturn(1);
    var result = service.change(1L, new MenuStatusRequest(state));
    assertThat(result.menuId()).isEqualTo(1);
    assertThat(result.status()).isEqualTo(state);
    verifyNoInteractions(menus);
  }

  @ParameterizedTest
  @EnumSource(MenuStatus.class)
  void sameStatusIsSuccessfulWhenMenuExists(MenuStatus state) {
    when(menus.existsById(1L)).thenReturn(true);
    assertThat(service.change(1L, new MenuStatusRequest(state)).status()).isEqualTo(state);
    verify(writes).changeIfDifferent(1L, state.name());
    verify(menus).existsById(1L);
  }

  @Test
  void missingMenuIs404() {
    assertThatThrownBy(() -> service.change(1L, new MenuStatusRequest(MenuStatus.HIDDEN)))
        .hasMessage("Menu not found");
  }

  @ParameterizedTest
  @NullSource
  @ValueSource(longs = {0, -1})
  void invalidIdDoesNotAccessDatabase(Long id) {
    assertThatThrownBy(() -> service.change(id, new MenuStatusRequest(MenuStatus.ON_SALE)))
        .isInstanceOf(MenuStatusChangeException.class);
    verifyNoInteractions(writes, menus);
  }

  @Test
  void invalidRequestDoesNotAccessDatabase() {
    assertThatThrownBy(() -> service.change(1L, null))
        .isInstanceOf(MenuStatusChangeException.class);
    assertThatThrownBy(() -> service.change(1L, new MenuStatusRequest(null)))
        .isInstanceOf(MenuStatusChangeException.class);
    verifyNoInteractions(writes, menus);
  }

  @Test
  void propagatesDatabaseFailure() {
    when(writes.changeIfDifferent(1L, "PAUSED"))
        .thenThrow(new DataAccessResourceFailureException("private"));
    assertThatThrownBy(() -> service.change(1L, new MenuStatusRequest(MenuStatus.PAUSED)))
        .isInstanceOf(DataAccessResourceFailureException.class);
    verifyNoInteractions(menus);
  }
}
