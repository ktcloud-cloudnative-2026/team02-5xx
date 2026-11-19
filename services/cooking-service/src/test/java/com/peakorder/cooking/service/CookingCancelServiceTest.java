package com.peakorder.cooking.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.peakorder.cooking.config.ClockConfig;
import com.peakorder.cooking.dto.CookingCancelResponse;
import com.peakorder.cooking.entity.CookingTicket;
import com.peakorder.cooking.entity.CookingTicketItem;
import com.peakorder.cooking.entity.TicketStatus;
import com.peakorder.cooking.exception.BusinessException;
import com.peakorder.cooking.exception.ErrorCode;
import com.peakorder.cooking.repository.CookingTicketRepository;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class CookingCancelServiceTest {

  private static final Instant NOW = Instant.parse("2026-11-16T01:00:00Z");

  private CookingTicketRepository repository;
  private CookingCancelService service;

  @BeforeEach
  void setUp() {
    repository = mock(CookingTicketRepository.class);
    service = new CookingCancelService(repository, Clock.fixed(NOW, ClockConfig.ZONE));
  }

  private static CookingTicket waitingTicket() {
    return CookingTicket.create(
        1L,
        "261116-0001",
        List.of(CookingTicketItem.of(1L, "아메리카노", null, 1, 120)),
        NOW.minusSeconds(60));
  }

  private static ErrorCode errorCodeOf(Throwable e) {
    return ((BusinessException) e).errorCode();
  }

  @Test
  void WAITING이면_취소하고_CANCELED를_반환한다() {
    CookingTicket ticket = waitingTicket();
    when(repository.findWithLockByOrderId(1L)).thenReturn(Optional.of(ticket));

    CookingCancelResponse res = service.cancel(1L);

    assertThat(res).isEqualTo(new CookingCancelResponse(1L, TicketStatus.CANCELED));
    assertThat(ticket.getCanceledAt()).isEqualTo(NOW);
  }

  @Test
  void 이미_취소된_전표에_다시_요청하면_같은_결과를_반환한다() {
    CookingTicket ticket = waitingTicket();
    ticket.cancel(NOW.minusSeconds(10));
    when(repository.findWithLockByOrderId(1L)).thenReturn(Optional.of(ticket));

    CookingCancelResponse res = service.cancel(1L);

    assertThat(res).isEqualTo(new CookingCancelResponse(1L, TicketStatus.CANCELED));
    assertThat(ticket.getCanceledAt()).isEqualTo(NOW.minusSeconds(10)); // 처음 취소 시각 유지
  }

  @Test
  void 조리_중이면_COOKING_ALREADY_STARTED() {
    CookingTicket ticket = waitingTicket();
    ticket.start(NOW.minusSeconds(5));
    when(repository.findWithLockByOrderId(1L)).thenReturn(Optional.of(ticket));

    assertThatThrownBy(() -> service.cancel(1L))
        .isInstanceOf(BusinessException.class)
        .extracting(CookingCancelServiceTest::errorCodeOf)
        .isEqualTo(ErrorCode.COOKING_ALREADY_STARTED);
    assertThat(ticket.getStatus()).isEqualTo(TicketStatus.COOKING);
  }

  @Test
  void 조리_완료면_COOKING_ALREADY_DONE() {
    CookingTicket ticket = waitingTicket();
    ticket.start(NOW.minusSeconds(200));
    ticket.complete(NOW.minusSeconds(10));
    when(repository.findWithLockByOrderId(1L)).thenReturn(Optional.of(ticket));

    assertThatThrownBy(() -> service.cancel(1L))
        .isInstanceOf(BusinessException.class)
        .extracting(CookingCancelServiceTest::errorCodeOf)
        .isEqualTo(ErrorCode.COOKING_ALREADY_DONE);
  }

  @Test
  void 전표가_없으면_COOKING_TICKET_NOT_FOUND() {
    when(repository.findWithLockByOrderId(99L)).thenReturn(Optional.empty());

    assertThatThrownBy(() -> service.cancel(99L))
        .isInstanceOf(BusinessException.class)
        .extracting(CookingCancelServiceTest::errorCodeOf)
        .isEqualTo(ErrorCode.COOKING_TICKET_NOT_FOUND);
  }
}
