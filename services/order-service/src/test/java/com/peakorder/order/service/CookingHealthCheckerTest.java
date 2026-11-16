package com.peakorder.order.service;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.peakorder.order.client.CookingHealthClient;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class CookingHealthCheckerTest {

  private CookingHealthClient client;
  private CookingAvailability availability;
  private CookingHealthChecker checker;

  @BeforeEach
  void setUp() {
    client = mock(CookingHealthClient.class);
    availability = mock(CookingAvailability.class);
    checker = new CookingHealthChecker(client, availability);
  }

  @Test
  void healthy_response_records_success() {
    when(client.isUp()).thenReturn(true);

    checker.check();

    verify(availability).recordSuccess();
    verify(availability, never()).recordFailure();
  }

  @Test
  void unhealthy_response_records_failure() {
    when(client.isUp()).thenReturn(false);

    checker.check();

    verify(availability).recordFailure();
    verify(availability, never()).recordSuccess();
  }

  @Test
  void unexpected_exception_is_treated_as_failure_and_does_not_escape() {
    when(client.isUp()).thenThrow(new IllegalStateException("boom"));

    checker.check();

    verify(availability).recordFailure();
  }
}
