package com.peakorder.order.service;

import com.peakorder.order.client.CookingHealthClient;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** Cooking 헬스를 주기적으로 확인해 CookingAvailability에 반영한다. */
@Component
public class CookingHealthChecker {

  private final CookingHealthClient client;
  private final CookingAvailability availability;

  public CookingHealthChecker(CookingHealthClient client, CookingAvailability availability) {
    this.client = client;
    this.availability = availability;
  }

  @Scheduled(fixedDelayString = "${cooking-health.interval-ms:5000}")
  public void check() {
    boolean up;
    try {
      up = client.isUp();
    } catch (RuntimeException e) {
      up = false;
    }
    if (up) {
      availability.recordSuccess();
    } else {
      availability.recordFailure();
    }
  }
}
