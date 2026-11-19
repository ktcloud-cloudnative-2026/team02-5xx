package com.peakorder.menu.entity;

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
@Table(name = "menu_options")
public class MenuOption {
  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  @ManyToOne(fetch = FetchType.LAZY, optional = false)
  @JoinColumn(name = "menu_id", nullable = false)
  private Menu menu;

  @Column(nullable = false)
  private String name;

  @Column(name = "extra_price", nullable = false)
  private int extraPrice;

  @Column(name = "extra_cook_time_sec", nullable = false)
  private int extraCookTimeSec;

  @Column(name = "is_default", nullable = false)
  private boolean defaultOption;

  @Column(nullable = false)
  private boolean active;

  protected MenuOption() {}

  public MenuOption(
      Menu menu,
      String name,
      int extraPrice,
      int extraCookTimeSec,
      boolean defaultOption,
      boolean active) {
    this.menu = menu;
    this.name = name;
    this.extraPrice = extraPrice;
    this.extraCookTimeSec = extraCookTimeSec;
    this.defaultOption = defaultOption;
    this.active = active;
  }

  public Long getId() {
    return id;
  }

  public void updateInformation(
      String name, int extraPrice, int extraCookTimeSec, boolean defaultOption, boolean active) {
    this.name = name;
    this.extraPrice = extraPrice;
    this.extraCookTimeSec = extraCookTimeSec;
    this.defaultOption = defaultOption;
    this.active = active;
  }

  public Menu getMenu() {
    return menu;
  }

  public String getName() {
    return name;
  }

  public int getExtraPrice() {
    return extraPrice;
  }

  public int getExtraCookTimeSec() {
    return extraCookTimeSec;
  }

  public boolean isDefault() {
    return defaultOption;
  }

  public boolean isActive() {
    return active;
  }
}
