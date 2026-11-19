package com.peakorder.cooking.dto;

/**
 * CO-02 응답.
 *
 * @param expectedWaitSec 지금 주문하면 조리 시작까지 예상 대기(초) — CO-01과 같은 값
 * @param cookSec 선택한 메뉴들의 조리 시간 합(초) = Σ((기본 + 옵션 추가) × 수량)
 * @param expectedReadySec 조리 완료까지 예상(초) = expectedWaitSec + cookSec
 */
public record EstimateResponse(long expectedWaitSec, long cookSec, long expectedReadySec) {}
