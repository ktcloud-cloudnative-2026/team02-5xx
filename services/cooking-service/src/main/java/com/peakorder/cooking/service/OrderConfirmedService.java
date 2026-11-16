package com.peakorder.cooking.service;

import com.peakorder.cooking.entity.CookingTicket;
import com.peakorder.cooking.entity.CookingTicketItem;
import com.peakorder.cooking.messaging.OrderConfirmedEvent;
import com.peakorder.cooking.repository.CookingTicketRepository;
import com.peakorder.cooking.repository.ProcessedEventRepository;
import java.time.Clock;
import java.util.List;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * OrderConfirmed 처리: 조리 전표를 WAITING으로 등록한다.
 *
 * <p>처리 순서(ERD 3-8): ① processed_events에 eventId 저장(이미 있으면 업무 처리 없이 종료 → ack) → ② 전표 생성 → ③ 커밋 후
 * ack. 같은 주문의 전표가 이미 있으면(다른 eventId로 재발행 등) 경고만 남기고 종료한다. cooking_tickets.order_id UNIQUE가 최종
 * 안전장치다.
 *
 * <p>매핑(Order #51과 합의):
 *
 * <ul>
 *   <li>cook_time_sec = cookTimeSec + 옵션 extraCookTimeSec 합 (1개 기준)
 *   <li>option_summary = optionName을 ", "로 이어붙임 (옵션 없으면 NULL)
 *   <li>estimated_cook_sec = Σ(cook_time_sec × quantity) — CookingTicket.create에서 계산
 *   <li>queued_at = Cooking 등록 시각 (FIFO 기준)
 * </ul>
 */
@Service
public class OrderConfirmedService {

  private static final Logger log = LoggerFactory.getLogger(OrderConfirmedService.class);

  private final ProcessedEventRepository processedEventRepository;
  private final CookingTicketRepository ticketRepository;
  private final Clock clock;

  public OrderConfirmedService(
      ProcessedEventRepository processedEventRepository,
      CookingTicketRepository ticketRepository,
      Clock clock) {
    this.processedEventRepository = processedEventRepository;
    this.ticketRepository = ticketRepository;
    this.clock = clock;
  }

  @Transactional
  public void handle(OrderConfirmedEvent event) {
    if (processedEventRepository.insertIfAbsent(event.eventId()) == 0) {
      log.info("이미 처리한 OrderConfirmed 이벤트를 무시합니다 eventId={}", event.eventId());
      return;
    }
    if (ticketRepository.findByOrderId(event.orderId()).isPresent()) {
      log.warn("이미 조리 전표가 있는 주문입니다. 무시합니다 orderId={} eventId={}", event.orderId(), event.eventId());
      return;
    }

    List<CookingTicketItem> items =
        event.items().stream().map(OrderConfirmedService::toItem).toList();
    CookingTicket ticket =
        CookingTicket.create(event.orderId(), event.orderNo(), items, clock.instant());
    ticketRepository.save(ticket);
    log.info(
        "조리 대기열에 등록했습니다 orderId={} orderNo={} estimatedCookSec={}",
        ticket.getOrderId(),
        ticket.getOrderNo(),
        ticket.getEstimatedCookSec());
  }

  static CookingTicketItem toItem(OrderConfirmedEvent.Item item) {
    List<OrderConfirmedEvent.Option> options = item.options() == null ? List.of() : item.options();
    int cookTimeSec =
        item.cookTimeSec()
            + options.stream().mapToInt(OrderConfirmedEvent.Option::extraCookTimeSec).sum();
    String optionSummary =
        options.isEmpty()
            ? null
            : options.stream()
                .map(OrderConfirmedEvent.Option::optionName)
                .collect(Collectors.joining(", "));
    return CookingTicketItem.of(
        item.menuId(), item.menuName(), optionSummary, item.quantity(), cookTimeSec);
  }
}
