package com.peakorder.order.repository;

import com.peakorder.order.entity.Order;
import com.peakorder.order.entity.OrderStatus;
import jakarta.persistence.criteria.Predicate;
import java.time.OffsetDateTime;
import org.springframework.data.jpa.domain.Specification;

/** 관리자 주문 검색(OR-08) 조건. 필요한 조건만 이어 붙이고, 모두 AND로 묶는다. */
public final class OrderSpecifications {

  private OrderSpecifications() {}

  /** 주문 시각이 {@code from} 이상, {@code toExclusive} 미만. */
  public static Specification<Order> orderedBetween(
      OffsetDateTime from, OffsetDateTime toExclusive) {
    return (root, query, cb) ->
        cb.and(
            cb.greaterThanOrEqualTo(root.get("orderedAt"), from),
            cb.lessThan(root.get("orderedAt"), toExclusive));
  }

  public static Specification<Order> orderNoEquals(String orderNo) {
    return (root, query, cb) -> cb.equal(root.get("orderNo"), orderNo);
  }

  public static Specification<Order> statusEquals(OrderStatus status) {
    return (root, query, cb) -> cb.equal(root.get("status"), status);
  }

  /** 수동 확인이 필요한 취소 주문. {@code Order.needsManualReview()}·수동 확인 지표와 같은 기준이다. */
  public static Specification<Order> needsManualReview() {
    return (root, query, cb) -> {
      Predicate unfinished =
          cb.or(
              cb.isNull(root.get("stockRestoredAt")),
              cb.and(cb.isNotNull(root.get("paymentId")), cb.isNull(root.get("refundedAt"))));
      return cb.and(
          cb.equal(root.get("status"), OrderStatus.CANCELED),
          cb.isNotNull(root.get("orderNo")),
          cb.isNotNull(root.get("cancelFollowUpManualAt")),
          unfinished);
    };
  }
}
