package com.peakorder.order.service;

import com.peakorder.order.exception.BusinessException;
import com.peakorder.order.exception.ErrorCode;
import com.peakorder.order.messaging.CookingCompletedEvent;
import com.peakorder.order.repository.OrderRepository;
import com.peakorder.order.repository.ProcessedEventRepository;
import java.time.Clock;
import java.time.OffsetDateTime;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * CookingCompleted 처리: ① processed_events에 eventId 저장 → ② 주문 완료 반영을 한 트랜잭션에서 한다. 이미 처리한 이벤트면 업무 처리
 * 없이 끝낸다(중복 방지). 처리할 수 없으면 예외로 트랜잭션을 되돌려 재시도·보관(DLQ) 대상이 되게 한다.
 */
@Service
public class CookingCompletedService {

  private static final Logger log = LoggerFactory.getLogger(CookingCompletedService.class);

  private final ProcessedEventRepository processedEventRepository;
  private final OrderRepository orderRepository;
  private final Clock clock;

  public CookingCompletedService(
      ProcessedEventRepository processedEventRepository,
      OrderRepository orderRepository,
      Clock clock) {
    this.processedEventRepository = processedEventRepository;
    this.orderRepository = orderRepository;
    this.clock = clock;
  }

  @Transactional
  public void handle(CookingCompletedEvent event) {
    OffsetDateTime now = OffsetDateTime.now(clock);
    if (!processedEventRepository.insertIfAbsent(event.eventId(), now)) {
      log.info("이미 처리한 CookingCompleted 이벤트를 무시합니다 eventId={}", event.eventId());
      return;
    }
    var order =
        orderRepository
            .findWithLockById(event.orderId())
            .orElseThrow(() -> new BusinessException(ErrorCode.ORDER_NOT_FOUND));
    order.markCompleted(event.completedAt(), now);
  }
}
