package com.peakorder.order.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;

@Entity
@Table(name = "order_item_options")
public class OrderItemOption {

  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  @ManyToOne(fetch = FetchType.LAZY, optional = false)
  @JoinColumn(name = "order_item_id", nullable = false)
  private OrderItem orderItem;

  @Column(name = "option_id", nullable = false)
  private Long optionId;

  @Column(name = "option_name", nullable = false)
  private String optionName;

  @Column(name = "extra_price", nullable = false)
  private int extraPrice;

  protected OrderItemOption() {}

  /** 주문 항목에 붙이기 전의 값 묶음으로 쓰인다(orderItem 없이 생성). */
  public OrderItemOption(Long optionId, String optionName, int extraPrice) {
    this(null, optionId, optionName, extraPrice);
  }

  OrderItemOption(OrderItem orderItem, Long optionId, String optionName, int extraPrice) {
    this.orderItem = orderItem;
    this.optionId = optionId;
    this.optionName = optionName;
    this.extraPrice = extraPrice;
  }

  public Long getOptionId() {
    return optionId;
  }

  public String getOptionName() {
    return optionName;
  }

  public int getExtraPrice() {
    return extraPrice;
  }
}
