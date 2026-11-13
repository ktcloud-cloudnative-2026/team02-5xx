package com.peakorder.order.entity;

import jakarta.persistence.CascadeType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.OneToMany;
import jakarta.persistence.Table;
import java.util.ArrayList;
import java.util.List;

@Entity
@Table(name = "order_items")
public class OrderItem {

  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  @ManyToOne(fetch = FetchType.LAZY, optional = false)
  @JoinColumn(name = "order_id", nullable = false)
  private Order order;

  @Column(name = "menu_id", nullable = false)
  private Long menuId;

  @Column(name = "menu_name", nullable = false)
  private String menuName;

  @Column(name = "unit_price", nullable = false)
  private int unitPrice;

  @Column(nullable = false)
  private int quantity;

  @Column(name = "line_amount", nullable = false)
  private int lineAmount;

  @OneToMany(mappedBy = "orderItem", cascade = CascadeType.ALL, orphanRemoval = true)
  private List<OrderItemOption> options = new ArrayList<>();

  protected OrderItem() {}

  OrderItem(
      Order order,
      Long menuId,
      String menuName,
      int unitPrice,
      int quantity,
      List<OrderItemOption> optionSources) {
    this.order = order;
    this.menuId = menuId;
    this.menuName = menuName;
    this.unitPrice = unitPrice;
    this.quantity = quantity;
    int extra = 0;
    for (OrderItemOption source : optionSources) {
      OrderItemOption option =
          new OrderItemOption(
              this, source.getOptionId(), source.getOptionName(), source.getExtraPrice());
      options.add(option);
      extra = Math.addExact(extra, option.getExtraPrice());
    }
    this.lineAmount = Math.multiplyExact(Math.addExact(unitPrice, extra), quantity);
  }

  public Long getId() {
    return id;
  }

  public Long getMenuId() {
    return menuId;
  }

  public String getMenuName() {
    return menuName;
  }

  public int getUnitPrice() {
    return unitPrice;
  }

  public int getQuantity() {
    return quantity;
  }

  public int getLineAmount() {
    return lineAmount;
  }

  public List<OrderItemOption> getOptions() {
    return options;
  }
}
