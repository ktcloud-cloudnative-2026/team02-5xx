package com.peakorder.order.service;

import com.peakorder.order.client.InventoryClient.StockHold;
import com.peakorder.order.dto.OrderDetailResponse;
import com.peakorder.order.entity.Order;
import com.peakorder.order.entity.OrderItemOption;
import com.peakorder.order.exception.BusinessException;
import com.peakorder.order.exception.ErrorCode;
import com.peakorder.order.repository.OrderRepository;
import java.time.Clock;
import java.time.OffsetDateTime;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 주문 저장 단위 트랜잭션. 외부 서비스 호출 동안 DB 트랜잭션을 잡고 있지 않도록 OrderService와 분리했다. */
@Service
public class OrderTxService {

  private final OrderRepository orderRepository;
  private final Clock clock;

  public OrderTxService(OrderRepository orderRepository, Clock clock) {
    this.orderRepository = orderRepository;
    this.clock = clock;
  }

  public record PricedLine(
      Long menuId, String menuName, int unitPrice, int quantity, List<OrderItemOption> options) {}

  @Transactional
  public Long createTemporaryOrder(Long userId, List<PricedLine> lines) {
    Order order = Order.createTemporary(userId, now());
    for (PricedLine line : lines) {
      order.addItem(
          line.menuId(), line.menuName(), line.unitPrice(), line.quantity(), line.options());
    }
    return orderRepository.save(order).getId();
  }

  @Transactional
  public OrderDetailResponse markHeld(Long orderId, StockHold hold) {
    Order order =
        orderRepository
            .findById(orderId)
            .orElseThrow(() -> new BusinessException(ErrorCode.ORDER_NOT_FOUND));
    order.markHeld(hold.holdId(), hold.expiresAt(), now());
    return OrderDetailResponse.from(order);
  }

  @Transactional
  public void markFailed(Long orderId, String reason) {
    orderRepository.findById(orderId).ifPresent(order -> order.markFailed(reason, now()));
  }

  private OffsetDateTime now() {
    return OffsetDateTime.now(clock);
  }
}
