package com.peakorder.cooking.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.peakorder.cooking.entity.CookingTicket;
import com.peakorder.cooking.entity.CookingTicketItem;
import com.peakorder.cooking.entity.TicketStatus;
import com.peakorder.cooking.exception.BusinessException;
import com.peakorder.cooking.exception.ErrorCode;
import com.peakorder.cooking.repository.CookingTicketRepository;
import com.peakorder.cooking.repository.OutboxEventRepository;
import java.time.Instant;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.RepeatedTest;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.condition.DisabledIf;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.DockerClientFactory;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

/**
 * 취소(CI-03)·자동 조리 진행의 동시 실행을 실제 PostgreSQL에서 검증한다 (#114).
 *
 * <p>행 잠금(SELECT … FOR UPDATE)·advisory lock은 DB가 하는 동작이라 모의 테스트로는 확인할 수 없다. 각 시나리오는 서로 다른 스레드(=다른
 * DB 연결·트랜잭션)에서 실행한다. 테스트 설정은 DB 자동 설정을 끄므로 이 클래스에서만 다시 켜고, 스키마는 Flyway V1~V3로 만든다.
 *
 * <p>Docker가 없을 때: 로컬에서는 건너뛰지만, CI(환경 변수 {@code CI}가 있음)에서는 건너뛰지 않고 컨테이너 기동 실패로 <b>실패</b>한다. 통합
 * 테스트가 생략된 채 CI가 통과하는 것을 막기 위해서다.
 */
@Tag("integration")
@Testcontainers
@DisabledIf("dockerUnavailableOutsideCi")
@SpringBootTest(
    properties = {"spring.autoconfigure.exclude=", "spring.jpa.hibernate.ddl-auto=validate"})
class CookingRaceIntegrationTest {

  /** dev DB(t2-db)와 같은 PostgreSQL 버전 */
  @Container @ServiceConnection
  static PostgreSQLContainer postgres = new PostgreSQLContainer("postgres:16.15");

  /** CI가 아닌 곳(로컬)에서 Docker를 쓸 수 없을 때만 true → 건너뜀. CI에서는 항상 false라 실행된다. */
  static boolean dockerUnavailableOutsideCi() {
    return System.getenv("CI") == null && !DockerClientFactory.instance().isDockerAvailable();
  }

  /** 조리가 테스트 중에 끝나지 않도록 넉넉하게 */
  private static final int COOK_TIME_SEC = 600;

  private static final AtomicLong ORDER_ID = new AtomicLong(1);

  /** 시나리오 2·2-반대에서 잠금을 잡고 버티는 시간. CI가 느려도 상대가 도착할 여유를 둔다. */
  private static final long LOCK_HOLD_MS = 1500;

  /** 상대가 잠금을 실제로 기다렸다고 볼 최소 시간(LOCK_HOLD_MS보다 1초 여유) */
  private static final long MIN_LOCK_WAIT_MS = 500;

  /** 신호를 기다리는 최대 시간. 넘기면 무한 대기 대신 실패한다. */
  private static final long SIGNAL_TIMEOUT_SEC = 10;

  @Autowired CookingCancelService cancelService;
  @Autowired CookingProgressService progressService;
  @Autowired CookingTicketRepository ticketRepository;
  @Autowired OutboxEventRepository outboxEventRepository;
  @Autowired PlatformTransactionManager transactionManager;

  @BeforeEach
  void clean() {
    ticketRepository.deleteAll();
    outboxEventRepository.deleteAll();
  }

  /**
   * 시나리오 1: 취소(A)와 tick()이 같은 순간에 출발해도 A는 취소와 조리 중 한쪽만 된다.
   *
   * <ul>
   *   <li>취소가 이기면: A=CANCELED, 취소 성공, B=COOKING 또는 아직 WAITING(같은 tick에서 넘어가는지는 시나리오 2에서 확인)
   *   <li>tick이 이기면: A=COOKING, 취소는 409 COOKING_ALREADY_STARTED, B=WAITING
   * </ul>
   */
  @RepeatedTest(20)
  void 취소와_조리시작이_동시에_와도_한쪽만_반영된다() throws Exception {
    long a = saveWaiting();
    long b = saveWaiting();

    Object cancelResult;
    try (ExecutorService pool = Executors.newFixedThreadPool(2)) {
      CountDownLatch ready = new CountDownLatch(2);
      CountDownLatch go = new CountDownLatch(1);
      Future<Object> cancel =
          pool.submit(() -> {
            ready.countDown();
            awaitSignal(go);
            try {
              cancelService.cancel(a);
              return "CANCELED";
            } catch (BusinessException e) {
              return e.errorCode();
            }
          });
      Future<?> tick =
          pool.submit(() -> {
            ready.countDown();
            awaitSignal(go);
            progressService.tick();
            return null;
          });
      awaitOrFail(ready, "준비", cancel, tick);
      go.countDown();
      cancelResult = cancel.get(SIGNAL_TIMEOUT_SEC, TimeUnit.SECONDS);
      tick.get(SIGNAL_TIMEOUT_SEC, TimeUnit.SECONDS);
    }

    TicketStatus statusA = status(a);
    TicketStatus statusB = status(b);
    assertThat(ticketRepository.countByStatus(TicketStatus.COOKING)).isLessThanOrEqualTo(1);
    if (statusA == TicketStatus.CANCELED) {
      assertThat(cancelResult).isEqualTo("CANCELED");
      assertThat(statusB).isIn(TicketStatus.COOKING, TicketStatus.WAITING);
    } else {
      assertThat(statusA).isEqualTo(TicketStatus.COOKING);
      assertThat(cancelResult).isEqualTo(ErrorCode.COOKING_ALREADY_STARTED);
      assertThat(statusB).isEqualTo(TicketStatus.WAITING);
    }
    System.out.printf("[시나리오1] 취소=%s A=%s B=%s%n", cancelResult, statusA, statusB);
  }

  /**
   * 시나리오 2: 취소가 A를 먼저 잠그면 tick()은 잠금이 풀릴 때까지 기다린 뒤 A를 건너뛰고, <b>같은 tick에서</b> B가 조리를 시작한다.
   *
   * <p>기다린 행(A)이 조건(status = WAITING)에서 빠지면 PostgreSQL이 그 행을 버리고 다음 행(B)을 잠가 돌려준다(PostgreSQL 16, 이
   * 테스트 이미지 16.15에서 확인. 실행 계획 Limit → LockRows). 순서를 강제하므로 매번 같은 결과여야 한다.
   */
  @RepeatedTest(5)
  void 취소가_먼저_잠그면_조리시작은_기다린_뒤_다음_전표로_넘어간다() throws Exception {
    long a = saveWaiting();
    long b = saveWaiting();
    TransactionTemplate tx = new TransactionTemplate(transactionManager);

    long waitedMs;
    try (ExecutorService pool = Executors.newSingleThreadExecutor()) {
      CountDownLatch locked = new CountDownLatch(1);
      Future<?> cancelHoldingLock =
          pool.submit(() ->
              tx.executeWithoutResult(status -> {
                CookingTicket ticket = ticketRepository.findWithLockByOrderId(a).orElseThrow();
                ticket.cancel(Instant.now());
                locked.countDown();
                sleep(LOCK_HOLD_MS); // 잠금을 잡은 채로 버틴다
              }));
      awaitOrFail(locked, "잠금", cancelHoldingLock);
      long start = System.nanoTime();
      progressService.tick();
      waitedMs = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start);
      cancelHoldingLock.get(SIGNAL_TIMEOUT_SEC, TimeUnit.SECONDS);
    }

    System.out.printf("[시나리오2] 대기=%dms 첫 tick 후 B=%s%n", waitedMs, status(b));
    assertThat(waitedMs).as("tick()이 A의 행 잠금을 기다렸는지").isGreaterThanOrEqualTo(MIN_LOCK_WAIT_MS);
    assertThat(status(a)).isEqualTo(TicketStatus.CANCELED);
    assertThat(status(b)).as("같은 tick에서 다음 전표로 넘어갔는지").isEqualTo(TicketStatus.COOKING);
  }

  /**
   * 시나리오 2-반대: 조리 시작이 A를 먼저 잠그면 취소는 잠금이 풀릴 때까지 기다린 뒤 COOKING을 보고 409 COOKING_ALREADY_STARTED로 끝난다.
   * 시나리오 1에서 잘 나오지 않는 "조리가 이기는 경우"를 순서를 강제해 확인한다.
   */
  @RepeatedTest(5)
  void 조리시작이_먼저_잠그면_취소는_기다린_뒤_409로_끝난다() throws Exception {
    long a = saveWaiting();
    TransactionTemplate tx = new TransactionTemplate(transactionManager);

    long waitedMs;
    Object cancelResult;
    try (ExecutorService pool = Executors.newSingleThreadExecutor()) {
      CountDownLatch locked = new CountDownLatch(1);
      Future<?> startHoldingLock =
          pool.submit(() ->
              tx.executeWithoutResult(status -> {
                CookingTicket ticket = ticketRepository.findWithLockByOrderId(a).orElseThrow();
                ticket.start(Instant.now());
                locked.countDown();
                sleep(LOCK_HOLD_MS); // 잠금을 잡은 채로 버틴다
              }));
      awaitOrFail(locked, "잠금", startHoldingLock);
      long start = System.nanoTime();
      try {
        cancelService.cancel(a);
        cancelResult = "CANCELED";
      } catch (BusinessException e) {
        cancelResult = e.errorCode();
      }
      waitedMs = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start);
      startHoldingLock.get(SIGNAL_TIMEOUT_SEC, TimeUnit.SECONDS);
    }

    System.out.printf("[시나리오2-반대] 대기=%dms 취소=%s A=%s%n", waitedMs, cancelResult, status(a));
    assertThat(waitedMs).as("취소가 A의 행 잠금을 기다렸는지").isGreaterThanOrEqualTo(MIN_LOCK_WAIT_MS);
    assertThat(cancelResult).isEqualTo(ErrorCode.COOKING_ALREADY_STARTED);
    assertThat(status(a)).isEqualTo(TicketStatus.COOKING);
  }

  /** 시나리오 3 (HPA 대비): tick() 두 개가 동시에 와도 advisory lock으로 한쪽만 실행돼, 예외 없이 COOKING은 1건이다. */
  @RepeatedTest(10)
  void tick_두개가_동시에_와도_조리는_한건만_시작된다() throws Exception {
    long a = saveWaiting();
    saveWaiting();

    try (ExecutorService pool = Executors.newFixedThreadPool(2)) {
      CountDownLatch ready = new CountDownLatch(2);
      CountDownLatch go = new CountDownLatch(1);
      Future<?> first =
          pool.submit(() -> {
            ready.countDown();
            awaitSignal(go);
            progressService.tick();
            return null;
          });
      Future<?> second =
          pool.submit(() -> {
            ready.countDown();
            awaitSignal(go);
            progressService.tick();
            return null;
          });
      awaitOrFail(ready, "준비", first, second);
      go.countDown();
      first.get(SIGNAL_TIMEOUT_SEC, TimeUnit.SECONDS); // V2 UNIQUE 위반 예외가 나면 여기서 실패
      second.get(SIGNAL_TIMEOUT_SEC, TimeUnit.SECONDS);
    }

    assertThat(ticketRepository.countByStatus(TicketStatus.COOKING)).isEqualTo(1);
    assertThat(status(a)).isEqualTo(TicketStatus.COOKING);
  }

  /**
   * 시나리오 4 (최종 보장): advisory lock을 거치지 않고 두 트랜잭션이 서로 다른 전표(A·B)를 동시에 COOKING으로 바꾸면, V2 부분 UNIQUE
   * 인덱스(uk_cooking_tickets_single_cooking)가 한쪽을 실패시켜 COOKING은 1건만 남는다.
   */
  @RepeatedTest(5)
  void 잠금을_우회해도_V2_UNIQUE가_COOKING_두건을_막는다() throws Exception {
    long a = saveWaiting();
    long b = saveWaiting();
    TransactionTemplate tx = new TransactionTemplate(transactionManager);

    int succeeded = 0;
    int uniqueViolations = 0;
    try (ExecutorService pool = Executors.newFixedThreadPool(2)) {
      CountDownLatch ready = new CountDownLatch(2);
      CountDownLatch go = new CountDownLatch(1);
      List<Future<?>> starts =
          List.of(a, b).stream()
              .<Future<?>>map(orderId ->
                  pool.submit(() -> {
                    ready.countDown();
                    awaitSignal(go);
                    tx.executeWithoutResult(status -> {
                      ticketRepository
                          .findWithLockByOrderId(orderId)
                          .orElseThrow()
                          .start(Instant.now());
                      ticketRepository.flush(); // UPDATE를 DB에 보냄
                      sleep(300); // 두 트랜잭션이 겹치도록 커밋 전에 버틴다
                    });
                    return null;
                  }))
              .toList();
      awaitOrFail(ready, "준비", starts.toArray(Future<?>[]::new));
      go.countDown();
      for (Future<?> start : starts) {
        try {
          start.get(SIGNAL_TIMEOUT_SEC, TimeUnit.SECONDS);
          succeeded++;
        } catch (ExecutionException e) {
          assertThat(causeMessages(e)).contains("uk_cooking_tickets_single_cooking");
          uniqueViolations++;
        }
      }
    }

    System.out.printf("[시나리오4] 성공=%d UNIQUE 위반=%d%n", succeeded, uniqueViolations);
    assertThat(succeeded).isEqualTo(1);
    assertThat(uniqueViolations).isEqualTo(1);
    assertThat(ticketRepository.countByStatus(TicketStatus.COOKING)).isEqualTo(1);
  }

  /** 작업 스레드: 출발 신호를 제한 시간 안에 받지 못하면 예외로 끝낸다(메인이 먼저 실패해도 스레드가 남지 않게). */
  private static void awaitSignal(CountDownLatch go) throws InterruptedException {
    if (!go.await(SIGNAL_TIMEOUT_SEC, TimeUnit.SECONDS)) {
      throw new IllegalStateException("출발 신호를 받지 못했습니다");
    }
  }

  /** 메인 스레드: 작업 스레드의 신호를 제한 시간 안에 받지 못하면 실패한다. 작업 스레드가 신호 전에 예외로 끝났다면 그 예외를 그대로 보여 준다. */
  private static void awaitOrFail(CountDownLatch latch, String what, Future<?>... workers)
      throws Exception {
    if (latch.await(SIGNAL_TIMEOUT_SEC, TimeUnit.SECONDS)) {
      return;
    }
    for (Future<?> worker : workers) {
      if (worker.isDone()) {
        worker.get(); // 작업 스레드의 예외(ExecutionException)를 그대로 던진다
      }
    }
    throw new AssertionError(what + " 신호를 " + SIGNAL_TIMEOUT_SEC + "초 안에 받지 못했습니다");
  }

  private static String causeMessages(Throwable error) {
    StringBuilder messages = new StringBuilder();
    for (Throwable t = error; t != null; t = t.getCause()) {
      messages.append(t.getMessage()).append('\n');
    }
    return messages.toString();
  }

  private long saveWaiting() {
    long orderId = ORDER_ID.getAndIncrement();
    ticketRepository.save(
        CookingTicket.create(
            orderId,
            "TEST-" + orderId,
            List.of(CookingTicketItem.of(1L, "테스트 메뉴", null, 1, COOK_TIME_SEC))));
    return orderId;
  }

  private TicketStatus status(long orderId) {
    return ticketRepository.findByOrderId(orderId).orElseThrow().getStatus();
  }

  private static void sleep(long millis) {
    try {
      Thread.sleep(millis);
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      throw new IllegalStateException(e);
    }
  }
}
