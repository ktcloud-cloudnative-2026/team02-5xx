package com.peakorder.cooking.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;

/** 혼잡 판단 기준값. 예상 대기 시간이 busyWaitSec 이상이면 혼잡으로 본다. */
@Entity
@Table(name = "congestion_thresholds")
public class CongestionThreshold {

  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  @Column(name = "busy_wait_sec", nullable = false)
  private int busyWaitSec;

  @Column(name = "updated_at", nullable = false)
  private Instant updatedAt;

  protected CongestionThreshold() {}

  public static CongestionThreshold of(int busyWaitSec, Instant now) {
    CongestionThreshold threshold = new CongestionThreshold();
    threshold.change(busyWaitSec, now);
    return threshold;
  }

  public void change(int busyWaitSec, Instant now) {
    if (busyWaitSec <= 0) {
      throw new IllegalArgumentException("혼잡 기준 시간은 1초 이상이어야 합니다.");
    }
    this.busyWaitSec = busyWaitSec;
    this.updatedAt = now;
  }

  public boolean isBusy(int expectedWaitSec) {
    return expectedWaitSec >= busyWaitSec;
  }

  public Long getId() {
    return id;
  }

  public int getBusyWaitSec() {
    return busyWaitSec;
  }

  public Instant getUpdatedAt() {
    return updatedAt;
  }
}
