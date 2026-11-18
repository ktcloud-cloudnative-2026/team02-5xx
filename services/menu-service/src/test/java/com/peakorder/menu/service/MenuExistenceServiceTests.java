package com.peakorder.menu.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.peakorder.menu.entity.Menu;
import com.peakorder.menu.entity.MenuStatus;
import com.peakorder.menu.exception.InvalidMenuIdException;
import com.peakorder.menu.repository.MenuRepository;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.junit.jupiter.params.provider.NullSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.dao.DataAccessResourceFailureException;

class MenuExistenceServiceTests {
  private final MenuRepository menus = mock(MenuRepository.class);
  private final MenuExistenceService service = new MenuExistenceService(menus);

  @ParameterizedTest
  @EnumSource(MenuStatus.class)
  void returnsStoredStatusWithoutApplyingInventoryLinkPolicy(MenuStatus status) {
    when(menus.findById(1L))
        .thenReturn(Optional.of(new Menu(null, "Menu", null, null, 0, 0, status)));
    var result = service.check(1L);
    assertThat(result.menuId()).isEqualTo(1L);
    assertThat(result.exists()).isTrue();
    assertThat(result.status()).isEqualTo(status);
    verify(menus).findById(1L);
  }

  @Test
  void returnsMissingResultForLargestValidId() {
    when(menus.findById(Long.MAX_VALUE)).thenReturn(Optional.empty());
    var result = service.check(Long.MAX_VALUE);
    assertThat(result.menuId()).isEqualTo(Long.MAX_VALUE);
    assertThat(result.exists()).isFalse();
    assertThat(result.status()).isNull();
  }

  @ParameterizedTest
  @NullSource
  @ValueSource(longs = {0, -1, Long.MIN_VALUE})
  void rejectsInvalidIdsBeforeQuerying(Long id) {
    assertThatThrownBy(() -> service.check(id)).isInstanceOf(InvalidMenuIdException.class);
    verifyNoInteractions(menus);
  }

  @Test
  void propagatesDatabaseFailuresInsteadOfReturningMissing() {
    var failure = new DataAccessResourceFailureException("private database detail");
    when(menus.findById(1L)).thenThrow(failure);
    assertThatThrownBy(() -> service.check(1L)).isSameAs(failure);
  }
}
