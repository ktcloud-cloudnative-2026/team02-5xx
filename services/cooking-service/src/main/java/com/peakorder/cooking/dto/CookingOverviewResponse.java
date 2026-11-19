package com.peakorder.cooking.dto;

import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * CO-03 관리자 조리 현황.
 *
 * @param completedToday 오늘(KST 0시 이후) 완료 건수
 * @param canceledToday 오늘(KST 0시 이후) 취소 건수
 * @param cookingOrderNo 현재 조리 중인 주문번호 (없으면 생략)
 * @param expectedWaitSec 지금 주문하면 조리 시작까지 예상 대기 시간(초)
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record CookingOverviewResponse(
    long waitingCount,
    long cookingCount,
    long completedToday,
    long canceledToday,
    String cookingOrderNo,
    long expectedWaitSec) {}
