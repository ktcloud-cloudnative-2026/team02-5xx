package com.peakorder.cooking.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;

/** 조리 항목. 메뉴 정보는 다른 서비스 데이터를 복사해 저장한다 (FK 없음). */
@Entity
@Table(name = "cooking_ticket_items")
public class CookingTicketItem {

  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  @ManyToOne(fetch = FetchType.LAZY, optional = false)
  @JoinColumn(name = "ticket_id", nullable = false)
  private CookingTicket ticket;

  @Column(name = "menu_id", nullable = false)
  private Long menuId;

  @Column(name = "menu_name", nullable = false, length = 100)
  private String menuName;

  @Column(name = "option_summary", length = 255)
  private String optionSummary;

  @Column(name = "quantity", nullable = false)
  private int quantity;

  @Column(name = "cook_time_sec", nullable = false)
  private int cookTimeSec;

  protected CookingTicketItem() {}

  public static CookingTicketItem of(
      Long menuId, String menuName, String optionSummary, int quantity, int cookTimeSec) {
    if (quantity <= 0) {
      throw new IllegalArgumentException("수량은 1 이상이어야 합니다.");
    }
    if (cookTimeSec < 0) {
      throw new IllegalArgumentException("조리 시간은 0 이상이어야 합니다.");
    }
    CookingTicketItem item = new CookingTicketItem();
    item.menuId = menuId;
    item.menuName = menuName;
    item.optionSummary = optionSummary;
    item.quantity = quantity;
    item.cookTimeSec = cookTimeSec;
    return item;
  }

  void assignTicket(CookingTicket ticket) {
    this.ticket = ticket;
  }

  public Long getId() {
    return id;
  }

  public CookingTicket getTicket() {
    return ticket;
  }

  public Long getMenuId() {
    return menuId;
  }

  public String getMenuName() {
    return menuName;
  }

  public String getOptionSummary() {
    return optionSummary;
  }

  public int getQuantity() {
    return quantity;
  }

  public int getCookTimeSec() {
    return cookTimeSec;
  }
}
