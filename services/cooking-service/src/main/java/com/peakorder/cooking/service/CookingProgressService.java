package com.peakorder.cooking.service;

import com.peakorder.cooking.config.ClockConfig;
import com.peakorder.cooking.entity.CookingTicket;
import com.peakorder.cooking.entity.OutboxEvent;
import com.peakorder.cooking.entity.TicketStatus;
import com.peakorder.cooking.messaging.CookingCompletedEvent;
import com.peakorder.cooking.repository.CookingTicketRepository;
import com.peakorder.cooking.repository.OutboxEventRepository;
import java.time.Clock;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;

/**
 * 자동 조리 진행 (회의 11/5·11/11 결정, US-09). 상태 변경 API는 없고 스케줄러가 주기적으로 {@link #tick()}을 호출한다.
 *
 * <ol>
 *   <li>advisory lock을 얻지 못하면 종료 — 여러 인스턴스 중 하나만 실행
 *   <li>COOKING 전표가 있고 예상 조리 시간(started_at + estimated_cook_sec)이 지났으면 DONE으로 바꾸고, 같은 트랜잭션에서
 *       CookingCompleted를 outbox에 PENDING으로 저장 (발행은 별도 작업)
 *   <li>COOKING 전표가 없으면 FIFO 첫 WAITING을 COOKING으로 시작
 * </ol>
 *
 * <p>전표는 행 잠금으로 읽어 CI-03 취소와 동시에 일어나도 한쪽만 반영된다. 매장당 COOKING 1건은 V2의 부분 UNIQUE 인덱스가 최종 보장한다.
 */
@Service
public class CookingProgressService {

  /** 자동 조리 진행용 advisory lock 키 (Cooking DB 안에서만 쓰임) */
  static final long PROGRESS_LOCK_KEY = 7_201_001L;

  private static final Logger log = LoggerFactory.getLogger(CookingProgressService.class);

  private final CookingTicketRepository ticketRepository;
  private final OutboxEventRepository outboxEventRepository;
  private final JsonMapper jsonMapper;
  private final Clock clock;
  private final CookingMetrics metrics;

  public CookingProgressService(
      CookingTicketRepository ticketRepository,
      OutboxEventRepository outboxEventRepository,
      JsonMapper jsonMapper,
      Clock clock,
      CookingMetrics metrics) {
    this.ticketRepository = ticketRepository;
    this.outboxEventRepository = outboxEventRepository;
    this.jsonMapper = jsonMapper;
    this.clock = clock;
    this.metrics = metrics;
  }

  @Transactional
  public void tick() {
    if (!ticketRepository.tryAdvisoryXactLock(PROGRESS_LOCK_KEY)) {
      return;
    }
    Instant now = clock.instant();

    Optional<CookingTicket> cooking =
        ticketRepository.findFirstWithLockByStatusOrderByQueuedAtAscIdAsc(TicketStatus.COOKING);
    if (cooking.isPresent()) {
      CookingTicket ticket = cooking.get();
      Instant due = ticket.getStartedAt().plusSeconds(ticket.getEstimatedCookSec());
      if (now.isBefore(due)) {
        return; // 아직 조리 중
      }
      complete(ticket, now);
      // COOKING → DONE을 먼저 DB에 반영해야 다음 전표를 COOKING으로 바꿀 때 V2 제약(COOKING 1건)에 걸리지 않는다
      ticketRepository.flush();
    }

    ticketRepository
        .findFirstWithLockByStatusOrderByQueuedAtAscIdAsc(TicketStatus.WAITING)
        .filter(t -> t.getStatus() == TicketStatus.WAITING)
        .ifPresent(t -> start(t, now));
  }

  private void complete(CookingTicket ticket, Instant now) {
    ticket.complete(now);
    UUID eventId = UUID.randomUUID();
    CookingCompletedEvent event =
        new CookingCompletedEvent(
            eventId, ticket.getOrderId(), now.atZone(ClockConfig.ZONE).toOffsetDateTime());
    outboxEventRepository.save(
        OutboxEvent.create(
            eventId, CookingCompletedEvent.EVENT_TYPE, jsonMapper.writeValueAsString(event), now));
    log.info(
        "조리를 완료했습니다 orderId={} orderNo={} eventId={}",
        ticket.getOrderId(),
        ticket.getOrderNo(),
        eventId);
    metrics.ticketCompleted();
  }

  private void start(CookingTicket ticket, Instant now) {
    ticket.start(now);
    log.info(
        "조리를 시작했습니다 orderId={} orderNo={} estimatedCookSec={}",
        ticket.getOrderId(),
        ticket.getOrderNo(),
        ticket.getEstimatedCookSec());
    metrics.ticketStarted();
  }
}
