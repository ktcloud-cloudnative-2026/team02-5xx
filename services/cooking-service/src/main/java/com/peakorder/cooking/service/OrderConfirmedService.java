package com.peakorder.cooking.service;

import com.peakorder.cooking.entity.CookingTicket;
import com.peakorder.cooking.entity.CookingTicketItem;
import com.peakorder.cooking.messaging.OrderConfirmedEvent;
import com.peakorder.cooking.repository.CookingTicketRepository;
import com.peakorder.cooking.repository.ProcessedEventRepository;
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
 *   <li>queued_at = Cooking DB 등록 시각 (FIFO 기준) — 저장 시 DB가 기록(CookingTicket)
 *   <li>menu_name·option_summary는 표시용 복사 값이라 컬럼 길이(100·255자)를 넘으면 잘라서 저장한다. 결제가 끝난 주문이 길이 초과로
 *       INSERT에 실패해 DLQ로 가고 조리 전표가 생기지 않는 것을 막는다 (#111)
 * </ul>
 */
@Service
public class OrderConfirmedService {

  private static final Logger log = LoggerFactory.getLogger(OrderConfirmedService.class);

  private final ProcessedEventRepository processedEventRepository;
  private final CookingTicketRepository ticketRepository;
  private final CookingMetrics metrics;

  public OrderConfirmedService(
      ProcessedEventRepository processedEventRepository,
      CookingTicketRepository ticketRepository,
      CookingMetrics metrics) {
    this.processedEventRepository = processedEventRepository;
    this.ticketRepository = ticketRepository;
    this.metrics = metrics;
  }

  @Transactional
  public void handle(OrderConfirmedEvent event) {
    if (processedEventRepository.insertIfAbsent(event.eventId()) == 0) {
      log.info("이미 처리한 OrderConfirmed 이벤트를 무시합니다 eventId={}", event.eventId());
      metrics.orderConfirmedDuplicate();
      return;
    }
    if (ticketRepository.findByOrderId(event.orderId()).isPresent()) {
      log.warn("이미 조리 전표가 있는 주문입니다. 무시합니다 orderId={} eventId={}", event.orderId(), event.eventId());
      metrics.orderConfirmedDuplicate();
      return;
    }

    List<CookingTicketItem> items =
        event.items().stream().map(item -> toItem(event.orderId(), item)).toList();
    CookingTicket ticket = CookingTicket.create(event.orderId(), event.orderNo(), items);
    ticketRepository.save(ticket);
    log.info(
        "조리 대기열에 등록했습니다 orderId={} orderNo={} estimatedCookSec={} queuedAt={}",
        ticket.getOrderId(),
        ticket.getOrderNo(),
        ticket.getEstimatedCookSec(),
        ticket.getQueuedAt());
    metrics.orderConfirmedCreated();
  }

  static CookingTicketItem toItem(Long orderId, OrderConfirmedEvent.Item item) {
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
        item.menuId(),
        fitToColumn(orderId, "menuName", item.menuName(), CookingTicketItem.MENU_NAME_MAX_LENGTH),
        fitToColumn(
            orderId, "optionSummary", optionSummary, CookingTicketItem.OPTION_SUMMARY_MAX_LENGTH),
        item.quantity(),
        cookTimeSec);
  }

  /** 컬럼 길이를 넘으면 잘라서 반환하고 경고 로그를 남긴다. */
  private static String fitToColumn(Long orderId, String field, String value, int maxLength) {
    String fitted = truncate(value, maxLength);
    if (value != null && fitted.length() != value.length()) {
      log.warn(
          "표시용 문자열이 컬럼 길이를 넘어 잘라서 저장합니다 orderId={} field={} length={} maxLength={}",
          orderId,
          field,
          value.codePointCount(0, value.length()),
          maxLength);
    }
    return fitted;
  }

  /**
   * 문자(코드 포인트) 기준으로 최대 {@code maxLength}자까지 남긴다. PostgreSQL VARCHAR(n)도 문자 수 기준이다. Java {@code
   * String.length()}는 UTF-16 단위라 이모지 같은 보조 문자는 2로 세므로, 코드 포인트 경계에서 잘라 문자가 깨지지 않게 한다.
   *
   * @return 길이 이내면 같은 객체, 넘으면 잘린 새 문자열 (null은 null)
   */
  static String truncate(String value, int maxLength) {
    if (value == null || value.length() <= maxLength) {
      return value; // UTF-16 길이 ≥ 문자 수이므로 여기서 걸리면 항상 이내
    }
    if (value.codePointCount(0, value.length()) <= maxLength) {
      return value;
    }
    return value.substring(0, value.offsetByCodePoints(0, maxLength));
  }
}
