package com.peakorder.cooking.entity;

import jakarta.persistence.CascadeType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.OneToMany;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import org.hibernate.annotations.CurrentTimestamp;
import org.hibernate.annotations.SourceType;
import org.hibernate.generator.EventType;

/** 조리 전표. OrderConfirmed 이벤트 1건당 1개 생성된다. */
@Entity
@Table(name = "cooking_tickets")
public class CookingTicket {

  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  @Column(name = "order_id", nullable = false, unique = true)
  private Long orderId;

  @Column(name = "order_no", nullable = false, length = 30)
  private String orderNo;

  @Enumerated(EnumType.STRING)
  @Column(name = "status", nullable = false, length = 20)
  private TicketStatus status;

  @Column(name = "estimated_cook_sec", nullable = false)
  private int estimatedCookSec;

  /**
   * Cooking DB 등록 시각 (FIFO 기준). 애플리케이션 시각이 아니라 INSERT 시 DB가 current_timestamp로 기록하고 Hibernate가 다시
   * 읽어 온다 → 인스턴스가 여러 대여도 같은 DB 시계를 쓰므로 FIFO가 어긋나지 않는다(PR #47 리뷰, #107).
   */
  @CurrentTimestamp(event = EventType.INSERT, source = SourceType.DB)
  @Column(name = "queued_at", nullable = false, updatable = false)
  private Instant queuedAt;

  @Column(name = "started_at")
  private Instant startedAt;

  @Column(name = "completed_at")
  private Instant completedAt;

  @Column(name = "canceled_at")
  private Instant canceledAt;

  @OneToMany(mappedBy = "ticket", cascade = CascadeType.ALL, orphanRemoval = true)
  private List<CookingTicketItem> items = new ArrayList<>();

  protected CookingTicket() {}

  /**
   * 대기열에 등록할 전표를 만든다. 상태는 WAITING, 예상 조리 시간은 항목별 (1개 조리 시간 × 수량)의 합이다. 등록 시각(queuedAt)은 저장할 때 DB가
   * 정한다.
   */
  public static CookingTicket create(Long orderId, String orderNo, List<CookingTicketItem> items) {
    if (items == null || items.isEmpty()) {
      throw new IllegalArgumentException("조리 항목이 비어 있습니다.");
    }
    CookingTicket ticket = new CookingTicket();
    ticket.orderId = orderId;
    ticket.orderNo = orderNo;
    ticket.status = TicketStatus.WAITING;
    items.forEach(ticket::addItem);
    ticket.estimatedCookSec =
        items.stream().mapToInt(item -> item.getCookTimeSec() * item.getQuantity()).sum();
    return ticket;
  }

  private void addItem(CookingTicketItem item) {
    items.add(item);
    item.assignTicket(this);
  }

  /** 조리 시작: WAITING → COOKING */
  public void start(Instant now) {
    requireStatus(TicketStatus.WAITING, "조리 시작");
    this.status = TicketStatus.COOKING;
    this.startedAt = now;
  }

  /** 조리 완료: COOKING → DONE */
  public void complete(Instant now) {
    requireStatus(TicketStatus.COOKING, "조리 완료");
    this.status = TicketStatus.DONE;
    this.completedAt = now;
  }

  /** 취소: WAITING일 때만 가능 (CI-03 규칙) */
  public void cancel(Instant now) {
    requireStatus(TicketStatus.WAITING, "취소");
    this.status = TicketStatus.CANCELED;
    this.canceledAt = now;
  }

  public boolean isCancelable() {
    return status == TicketStatus.WAITING;
  }

  private void requireStatus(TicketStatus expected, String action) {
    if (status != expected) {
      throw new IllegalStateException(
          action + "은(는) " + expected + " 상태에서만 가능합니다. 현재 상태: " + status);
    }
  }

  public Long getId() {
    return id;
  }

  public Long getOrderId() {
    return orderId;
  }

  public String getOrderNo() {
    return orderNo;
  }

  public TicketStatus getStatus() {
    return status;
  }

  public int getEstimatedCookSec() {
    return estimatedCookSec;
  }

  public Instant getQueuedAt() {
    return queuedAt;
  }

  public Instant getStartedAt() {
    return startedAt;
  }

  public Instant getCompletedAt() {
    return completedAt;
  }

  public Instant getCanceledAt() {
    return canceledAt;
  }

  public List<CookingTicketItem> getItems() {
    return Collections.unmodifiableList(items);
  }
}
