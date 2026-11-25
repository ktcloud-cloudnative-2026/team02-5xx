package com.peakorder.menu.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import java.time.Instant;

@Entity
@Table(name = "menus")
public class Menu {
  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  @ManyToOne(fetch = FetchType.LAZY, optional = false)
  @JoinColumn(name = "category_id", nullable = false)
  private Category category;

  @Column(nullable = false)
  private String name;

  @Column(columnDefinition = "text")
  private String description;

  @Column(name = "image_url")
  private String imageUrl;

  @Column(name = "base_price", nullable = false)
  private int basePrice;

  @Column(name = "cook_time_sec", nullable = false)
  private int cookTimeSec;

  @Enumerated(EnumType.STRING)
  @Column(nullable = false, length = 20)
  private MenuStatus status;

  @Column(name = "created_at", nullable = false, updatable = false)
  private Instant createdAt;

  @Column(name = "updated_at", nullable = false)
  private Instant updatedAt;

  protected Menu() {}

  public Menu(
      Category category,
      String name,
      String description,
      String imageUrl,
      int basePrice,
      int cookTimeSec,
      MenuStatus status) {
    this.category = category;
    this.name = name;
    this.description = description;
    this.imageUrl = imageUrl;
    this.basePrice = basePrice;
    this.cookTimeSec = cookTimeSec;
    this.status = status;
  }

  @PrePersist
  void onCreate() {
    createdAt = Instant.now();
    updatedAt = createdAt;
  }

  @PreUpdate
  void onUpdate() {
    updatedAt = Instant.now();
  }

  public Long getId() {
    return id;
  }

  /** Update information without altering identity, creation time or sales status. */
  public void updateInformation(
      Category category,
      String name,
      String description,
      String imageUrl,
      int basePrice,
      int cookTimeSec) {
    this.category = category;
    this.name = name;
    this.description = description;
    this.imageUrl = imageUrl;
    this.basePrice = basePrice;
    this.cookTimeSec = cookTimeSec;
    // Also dirty the parent for option-only updates.
    this.updatedAt = Instant.now();
  }

  public Category getCategory() {
    return category;
  }

  public String getName() {
    return name;
  }

  public String getDescription() {
    return description;
  }

  public String getImageUrl() {
    return imageUrl;
  }

  public int getBasePrice() {
    return basePrice;
  }

  public int getCookTimeSec() {
    return cookTimeSec;
  }

  public MenuStatus getStatus() {
    return status;
  }

  public Instant getCreatedAt() {
    return createdAt;
  }

  public Instant getUpdatedAt() {
    return updatedAt;
  }
}
