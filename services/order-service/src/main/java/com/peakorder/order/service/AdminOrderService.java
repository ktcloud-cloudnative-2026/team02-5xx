package com.peakorder.order.service;

import com.peakorder.order.config.ClockConfig;
import com.peakorder.order.dto.AdminOrderDetailResponse;
import com.peakorder.order.dto.AdminOrderListResponse;
import com.peakorder.order.dto.AdminOrderSummaryResponse;
import com.peakorder.order.entity.Order;
import com.peakorder.order.entity.OrderStatus;
import com.peakorder.order.exception.BusinessException;
import com.peakorder.order.exception.ErrorCode;
import com.peakorder.order.repository.OrderRepository;
import com.peakorder.order.repository.OrderSpecifications;
import java.time.Clock;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.temporal.ChronoUnit;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 관리자 주문 조회(OR-08·OR-09). 읽기 전용이며 외부 서비스를 호출하지 않는다.
 *
 * <p>검색 기간은 주문 시각(KST 날짜) 기준이고 한 번에 최대 {@value #MAX_PERIOD_DAYS}일이다. 기간이 없으면 최근 {@value
 * #MAX_PERIOD_DAYS}일, 한쪽만 주면 반대쪽을 {@value #MAX_PERIOD_DAYS}일 범위로 채운다. 주문번호만 주면(유일키) 기간 없이 전체에서 찾는다.
 */
@Service
@Transactional(readOnly = true)
public class AdminOrderService {

  static final int MAX_PERIOD_DAYS = 31;

  /** 고객 목록(OR-03)과 같은 페이지 크기 한도. */
  static final int MAX_PAGE_SIZE = 100;

  private final OrderRepository orderRepository;
  private final Clock clock;

  public AdminOrderService(OrderRepository orderRepository, Clock clock) {
    this.orderRepository = orderRepository;
    this.clock = clock;
  }

  public AdminOrderListResponse search(
      LocalDate from,
      LocalDate to,
      String orderNo,
      String status,
      Boolean manualReviewRequired,
      int page,
      int size) {
    String normalizedOrderNo = orderNo == null || orderNo.isBlank() ? null : orderNo.trim();
    OrderStatus statusFilter = parseStatus(status);

    Specification<Order> spec = (root, query, cb) -> cb.conjunction();
    if (normalizedOrderNo != null) {
      spec = spec.and(OrderSpecifications.orderNoEquals(normalizedOrderNo));
    }
    if (!(normalizedOrderNo != null && from == null && to == null)) {
      Period period = resolvePeriod(from, to);
      spec = spec.and(OrderSpecifications.orderedBetween(period.from(), period.toExclusive()));
    }
    if (statusFilter != null) {
      spec = spec.and(OrderSpecifications.statusEquals(statusFilter));
    }
    if (Boolean.TRUE.equals(manualReviewRequired)) {
      spec = spec.and(OrderSpecifications.needsManualReview());
    }

    int safePage = Math.max(page, 0);
    int safeSize = Math.min(Math.max(size, 1), MAX_PAGE_SIZE);
    Page<Order> result =
        orderRepository.findAll(
            spec,
            PageRequest.of(safePage, safeSize, Sort.by(Sort.Direction.DESC, "orderedAt", "id")));
    return new AdminOrderListResponse(
        result.getContent().stream().map(AdminOrderSummaryResponse::from).toList(),
        safePage,
        safeSize,
        result.getTotalElements());
  }

  /** OR-09. 관리자는 모든 사용자의 주문을 볼 수 있다. 없는 주문은 404. */
  public AdminOrderDetailResponse get(Long orderId) {
    return orderRepository
        .findById(orderId)
        .map(AdminOrderDetailResponse::from)
        .orElseThrow(() -> new BusinessException(ErrorCode.ORDER_NOT_FOUND));
  }

  private Period resolvePeriod(LocalDate from, LocalDate to) {
    LocalDate start = from;
    LocalDate end = to;
    if (start == null && end == null) {
      end = LocalDate.now(clock);
      start = end.minusDays(MAX_PERIOD_DAYS - 1L);
    } else if (end == null) {
      end = start.plusDays(MAX_PERIOD_DAYS - 1L);
    } else if (start == null) {
      start = end.minusDays(MAX_PERIOD_DAYS - 1L);
    }
    if (start.isAfter(end) || ChronoUnit.DAYS.between(start, end) + 1 > MAX_PERIOD_DAYS) {
      throw new BusinessException(ErrorCode.INVALID_REQUEST);
    }
    return new Period(
        start.atStartOfDay(ClockConfig.ZONE).toOffsetDateTime(),
        end.plusDays(1).atStartOfDay(ClockConfig.ZONE).toOffsetDateTime());
  }

  private static OrderStatus parseStatus(String status) {
    if (status == null || status.isBlank()) {
      return null;
    }
    try {
      return OrderStatus.valueOf(status.trim().toUpperCase());
    } catch (IllegalArgumentException e) {
      throw new BusinessException(ErrorCode.INVALID_REQUEST);
    }
  }

  private record Period(OffsetDateTime from, OffsetDateTime toExclusive) {}
}
