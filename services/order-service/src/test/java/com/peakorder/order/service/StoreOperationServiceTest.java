package com.peakorder.order.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.peakorder.order.dto.StoreOperationResponse;
import com.peakorder.order.dto.UpdateStoreOperationRequest;
import com.peakorder.order.entity.StoreOperation;
import com.peakorder.order.exception.BusinessException;
import com.peakorder.order.exception.ErrorCode;
import com.peakorder.order.repository.StoreOperationRepository;
import java.time.Clock;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class StoreOperationServiceTest {

  private final OffsetDateTime now = OffsetDateTime.parse("2026-11-19T10:00:00+09:00");

  private StoreOperationRepository repository;
  private StoreOperationService service;

  @BeforeEach
  void setUp() {
    repository = mock(StoreOperationRepository.class);
    service =
        new StoreOperationService(
            repository, Clock.fixed(now.toInstant(), ZoneId.of("Asia/Seoul")));
  }

  private StoreOperation stored(boolean open, boolean accepting) {
    return new StoreOperation(open, accepting, now.minusHours(1));
  }

  private ErrorCode errorOf(Runnable call) {
    try {
      call.run();
    } catch (BusinessException e) {
      return e.errorCode();
    }
    return null;
  }

  @Test
  void get_returns_the_current_state() {
    when(repository.findById(StoreOperation.SINGLE_STORE_ID))
        .thenReturn(Optional.of(stored(true, false)));

    StoreOperationResponse response = service.get();

    assertThat(response.isOpen()).isTrue();
    assertThat(response.acceptingOrders()).isFalse();
    assertThat(response.updatedAt()).isEqualTo(now.minusHours(1));
  }

  @Test
  void update_changes_only_what_was_sent_using_the_row_lock() {
    StoreOperation store = stored(false, false);
    when(repository.findWithLockById(StoreOperation.SINGLE_STORE_ID))
        .thenReturn(Optional.of(store));

    StoreOperationResponse response = service.update(new UpdateStoreOperationRequest(true, null));

    assertThat(response.isOpen()).isTrue();
    assertThat(response.acceptingOrders()).isFalse();
    assertThat(response.updatedAt()).isEqualTo(now);
    assertThat(store.canAcceptOrders()).isFalse();
    verify(repository, never()).findById(StoreOperation.SINGLE_STORE_ID);
  }

  @Test
  void opening_and_accepting_makes_orders_acceptable_right_away() {
    StoreOperation store = stored(false, false);
    when(repository.findWithLockById(StoreOperation.SINGLE_STORE_ID))
        .thenReturn(Optional.of(store));

    service.update(new UpdateStoreOperationRequest(true, true));

    assertThat(store.canAcceptOrders()).isTrue();
  }

  @Test
  void update_with_nothing_to_change_is_rejected_before_touching_the_database() {
    assertThat(errorOf(() -> service.update(new UpdateStoreOperationRequest(null, null))))
        .isEqualTo(ErrorCode.INVALID_REQUEST);
    assertThat(errorOf(() -> service.update(null))).isEqualTo(ErrorCode.INVALID_REQUEST);

    verify(repository, never()).findWithLockById(StoreOperation.SINGLE_STORE_ID);
  }

  @Test
  void a_missing_store_row_is_an_internal_error_for_both_operations() {
    when(repository.findById(StoreOperation.SINGLE_STORE_ID)).thenReturn(Optional.empty());
    when(repository.findWithLockById(StoreOperation.SINGLE_STORE_ID)).thenReturn(Optional.empty());

    assertThatThrownBy(() -> service.get()).isInstanceOf(BusinessException.class);
    assertThat(errorOf(() -> service.update(new UpdateStoreOperationRequest(true, null))))
        .isEqualTo(ErrorCode.INTERNAL_ERROR);
  }
}
