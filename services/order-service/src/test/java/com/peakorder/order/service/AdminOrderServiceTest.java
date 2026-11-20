package com.peakorder.order.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.peakorder.order.dto.AdminOrderDetailResponse;
import com.peakorder.order.dto.AdminOrderListResponse;
import com.peakorder.order.entity.Order;
import com.peakorder.order.entity.OrderStatus;
import com.peakorder.order.exception.BusinessException;
import com.peakorder.order.exception.ErrorCode;
import com.peakorder.order.repository.OrderRepository;
import java.time.Clock;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.domain.Specification;

class AdminOrderServiceTest {

  private final OffsetDateTime now = OffsetDateTime.parse("2026-11-20T10:00:00+09:00");

  private OrderRepository repository;
  private AdminOrderService service;

  @BeforeEach
  @SuppressWarnings("unchecked")
  void setUp() {
    repository = mock(OrderRepository.class);
    service =
        new AdminOrderService(repository, Clock.fixed(now.toInstant(), ZoneId.of("Asia/Seoul")));
    when(repository.findAll(any(Specification.class), any(Pageable.class)))
        .thenReturn(new PageImpl<>(List.of()));
  }

  private void invalid(Runnable call) {
    assertThatThrownBy(call::run)
        .isInstanceOfSatisfying(
            BusinessException.class,
            e -> assertThat(e.errorCode()).isEqualTo(ErrorCode.INVALID_REQUEST));
    verify(repository, never()).findAll(any(Specification.class), any(Pageable.class));
  }

  @Test
  void a_period_longer_than_31_days_is_rejected() {
    invalid(
        () ->
            service.search(
                LocalDate.parse("2026-10-01"),
                LocalDate.parse("2026-11-01"),
                null,
                null,
                null,
                0,
                20));
  }

  @Test
  void a_period_of_exactly_31_days_is_accepted() {
    service.search(
        LocalDate.parse("2026-10-01"), LocalDate.parse("2026-10-31"), null, null, null, 0, 20);

    verify(repository).findAll(any(Specification.class), any(Pageable.class));
  }

  @Test
  void a_start_date_after_the_end_date_is_rejected() {
    invalid(
        () ->
            service.search(
                LocalDate.parse("2026-11-10"),
                LocalDate.parse("2026-11-01"),
                null,
                null,
                null,
                0,
                20));
  }

  @Test
  void an_unknown_status_is_rejected() {
    invalid(() -> service.search(null, null, null, "MAYBE", null, 0, 20));
  }

  @Test
  void status_is_case_insensitive() {
    service.search(null, null, null, "canceled", null, 0, 20);

    verify(repository).findAll(any(Specification.class), any(Pageable.class));
  }

  @Test
  void page_size_is_clamped_and_results_are_newest_first() {
    service.search(null, null, null, null, null, -3, 1000);

    ArgumentCaptor<Pageable> captor = ArgumentCaptor.forClass(Pageable.class);
    verify(repository).findAll(any(Specification.class), captor.capture());
    Pageable pageable = captor.getValue();
    assertThat(pageable.getPageNumber()).isZero();
    assertThat(pageable.getPageSize()).isEqualTo(AdminOrderService.MAX_PAGE_SIZE);
    assertThat(pageable.getSort().toString()).isEqualTo("orderedAt: DESC,id: DESC");
  }

  @Test
  void the_response_reports_the_effective_paging() {
    Page<Order> page =
        new PageImpl<>(List.of(), org.springframework.data.domain.PageRequest.of(0, 20), 37);
    when(repository.findAll(any(Specification.class), any(Pageable.class))).thenReturn(page);

    AdminOrderListResponse r = service.search(null, null, null, null, null, 0, 20);

    assertThat(r.totalElements()).isEqualTo(37);
    assertThat(r.size()).isEqualTo(20);
  }

  @Test
  void detail_of_any_users_order_includes_the_manual_review_info() {
    Order order = Order.createTemporary(7L, now);
    order.addItem(1L, "아메리카노", 3000, 1, List.of());
    order.markConfirmed("261120-0001", 55L, now);
    order.markCanceled("CUSTOMER_CANCEL", now);
    order.markStockRestored(now);
    order.markCancelFollowUpManual("REFUND_NOT_REFUNDABLE", now);
    when(repository.findById(5L)).thenReturn(Optional.of(order));

    AdminOrderDetailResponse r = service.get(5L);

    assertThat(r.userId()).isEqualTo(7L);
    assertThat(r.status()).isEqualTo(OrderStatus.CANCELED);
    assertThat(r.manualReviewRequired()).isTrue();
    assertThat(r.manualReviewReason()).isEqualTo("REFUND_NOT_REFUNDABLE");
    assertThat(r.paymentId()).isEqualTo(55L);
    assertThat(r.stockRestoredAt()).isNotNull();
    assertThat(r.refundedAt()).isNull();
    assertThat(r.items()).hasSize(1);
  }

  @Test
  void the_manual_reason_is_hidden_once_the_follow_ups_are_finished() {
    Order order = Order.createTemporary(7L, now);
    order.addItem(1L, "아메리카노", 3000, 1, List.of());
    order.markConfirmed("261120-0001", 55L, now);
    order.markCanceled("CUSTOMER_CANCEL", now);
    order.markCancelFollowUpManual("REFUND_NOT_REFUNDABLE", now);
    order.markStockRestored(now);
    order.markRefunded(now);
    when(repository.findById(5L)).thenReturn(Optional.of(order));

    AdminOrderDetailResponse r = service.get(5L);

    assertThat(r.manualReviewRequired()).isFalse();
    assertThat(r.manualReviewReason()).isNull();
  }

  @Test
  void a_missing_order_is_not_found() {
    when(repository.findById(9L)).thenReturn(Optional.empty());

    assertThatThrownBy(() -> service.get(9L))
        .isInstanceOfSatisfying(
            BusinessException.class,
            e -> assertThat(e.errorCode()).isEqualTo(ErrorCode.ORDER_NOT_FOUND));
  }
}
