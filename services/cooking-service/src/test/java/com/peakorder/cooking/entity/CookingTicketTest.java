package com.peakorder.cooking.entity;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;

/** 조리 전표의 생성 규칙과 상태 전환 규칙 (PR #47 리뷰, #107) */
class CookingTicketTest {

  private static final Instant T = Instant.parse("2026-11-18T01:00:00Z");

  private static CookingTicket waiting() {
    return CookingTicket.create(
        1L,
        "261118-0001",
        List.of(
            CookingTicketItem.of(1L, "아메리카노", "샷 추가", 2, 150),
            CookingTicketItem.of(2L, "라떼", null, 1, 90)));
  }

  @Test
  void 생성하면_WAITING이고_예상_조리_시간은_조리시간과_수량의_곱의_합이다() {
    CookingTicket ticket = waiting();

    assertThat(ticket.getStatus()).isEqualTo(TicketStatus.WAITING);
    assertThat(ticket.getEstimatedCookSec()).isEqualTo(150 * 2 + 90); // 390, OrderConfirmed 합의 예시
    assertThat(ticket.getItems()).hasSize(2).allMatch(item -> item.getTicket() == ticket);
    assertThat(ticket.getQueuedAt()).isNull(); // 등록 시각은 저장할 때 DB가 정한다
  }

  @Test
  void 조리_항목이_없으면_만들_수_없다() {
    assertThatThrownBy(() -> CookingTicket.create(1L, "261118-0001", List.of()))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> CookingTicket.create(1L, "261118-0001", null))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void WAITING에서_시작하고_COOKING에서_완료한다() {
    CookingTicket ticket = waiting();

    ticket.start(T);
    assertThat(ticket.getStatus()).isEqualTo(TicketStatus.COOKING);
    assertThat(ticket.getStartedAt()).isEqualTo(T);

    ticket.complete(T.plusSeconds(390));
    assertThat(ticket.getStatus()).isEqualTo(TicketStatus.DONE);
    assertThat(ticket.getCompletedAt()).isEqualTo(T.plusSeconds(390));
  }

  @Test
  void WAITING에서만_취소할_수_있다() {
    CookingTicket ticket = waiting();
    assertThat(ticket.isCancelable()).isTrue();

    ticket.cancel(T);

    assertThat(ticket.getStatus()).isEqualTo(TicketStatus.CANCELED);
    assertThat(ticket.getCanceledAt()).isEqualTo(T);
    assertThat(ticket.isCancelable()).isFalse();
  }

  @Test
  void 조리_중이거나_완료된_전표는_취소할_수_없다() {
    CookingTicket cooking = waiting();
    cooking.start(T);
    assertThatThrownBy(() -> cooking.cancel(T)).isInstanceOf(IllegalStateException.class);
    assertThat(cooking.getStatus()).isEqualTo(TicketStatus.COOKING);

    CookingTicket done = waiting();
    done.start(T);
    done.complete(T);
    assertThatThrownBy(() -> done.cancel(T)).isInstanceOf(IllegalStateException.class);
  }

  @Test
  void 이미_취소한_전표를_다시_취소하면_거절한다() {
    // CI-03의 멱등 200은 서비스(CookingCancelService)가 상태를 먼저 확인해 처리한다
    CookingTicket ticket = waiting();
    ticket.cancel(T);

    assertThatThrownBy(() -> ticket.cancel(T)).isInstanceOf(IllegalStateException.class);
  }

  @Test
  void 순서를_건너뛰는_전환은_거절한다() {
    CookingTicket ticket = waiting();
    assertThatThrownBy(() -> ticket.complete(T)).isInstanceOf(IllegalStateException.class);

    ticket.start(T);
    assertThatThrownBy(() -> ticket.start(T)).isInstanceOf(IllegalStateException.class);

    ticket.complete(T);
    assertThatThrownBy(() -> ticket.start(T)).isInstanceOf(IllegalStateException.class);
    assertThatThrownBy(() -> ticket.complete(T)).isInstanceOf(IllegalStateException.class);

    CookingTicket canceled = waiting();
    canceled.cancel(T);
    assertThatThrownBy(() -> canceled.start(T)).isInstanceOf(IllegalStateException.class);
  }
}
