package com.peakorder.cooking.dto;

import com.peakorder.cooking.entity.CookingTicket;
import com.peakorder.cooking.entity.TicketStatus;

/** CI-03 취소 응답 (Order와 합의한 형식) */
public record CookingCancelResponse(Long orderId, TicketStatus status) {

  public static CookingCancelResponse from(CookingTicket ticket) {
    return new CookingCancelResponse(ticket.getOrderId(), ticket.getStatus());
  }
}
