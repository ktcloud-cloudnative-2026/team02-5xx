package com.peakorder.cooking.service;

import static org.assertj.core.api.Assertions.assertThat;

import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/** Counter는 트랜잭션 커밋 뒤에만 오른다(#243). 트랜잭션 동기화를 직접 열고 닫아 커밋·롤백을 흉내 낸다. */
class CookingMetricsTest {

  private SimpleMeterRegistry registry;
  private CookingMetrics metrics;

  @BeforeEach
  void setUp() {
    registry = new SimpleMeterRegistry();
    metrics = new CookingMetrics(registry);
  }

  @AfterEach
  void tearDown() {
    if (TransactionSynchronizationManager.isSynchronizationActive()) {
      TransactionSynchronizationManager.clearSynchronization();
    }
  }

  private double started() {
    return registry.get("cooking.tickets.started").counter().count();
  }

  @Test
  void 트랜잭션_밖에서는_바로_오른다() {
    metrics.ticketStarted();

    assertThat(started()).isEqualTo(1);
  }

  @Test
  void 트랜잭션_안에서는_커밋된_뒤에_오른다() {
    TransactionSynchronizationManager.initSynchronization();

    metrics.ticketStarted();
    assertThat(started()).isZero();

    TransactionSynchronizationManager.getSynchronizations()
        .forEach(TransactionSynchronization::afterCommit);
    assertThat(started()).isEqualTo(1);
  }

  @Test
  void 롤백되면_오르지_않는다() {
    TransactionSynchronizationManager.initSynchronization();

    metrics.ticketStarted();
    TransactionSynchronizationManager.getSynchronizations()
        .forEach(s -> s.afterCompletion(TransactionSynchronization.STATUS_ROLLED_BACK));

    assertThat(started()).isZero();
  }

  @Test
  void 모든_Counter가_0으로_등록된다() {
    assertThat(registry.get("cooking.tickets.completed").counter().count()).isZero();
    assertThat(registry.get("cooking.tickets.canceled").counter().count()).isZero();
    assertThat(
            registry
                .get("cooking.order.confirmed.received")
                .tag("result", "created")
                .counter()
                .count())
        .isZero();
    assertThat(
            registry
                .get("cooking.order.confirmed.received")
                .tag("result", "duplicate")
                .counter()
                .count())
        .isZero();
  }
}
