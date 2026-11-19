package com.peakorder.payment.service;

import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * 모의 결제 승인기. 실제 PG 연동 없이 설정값으로 승인·거절을 정한다.
 *
 * <p>PAYMENT_MOCK_RESULT=APPROVE(기본) 또는 FAIL. 결제 실패 흐름을 시연할 때 FAIL로 바꾼다.
 */
@Component
public class MockPaymentGateway {

  public static final String DECLINED_REASON = "MOCK_DECLINED";

  private final boolean alwaysFail;

  public MockPaymentGateway(@Value("${payment.mock.result:APPROVE}") String mockResult) {
    this.alwaysFail = "FAIL".equalsIgnoreCase(mockResult);
  }

  /** 승인되면 모의 승인번호, 거절되면 null. */
  public String approve(Long orderId, int amount) {
    if (alwaysFail) {
      return null;
    }
    return "MOCK-" + UUID.randomUUID().toString().substring(0, 8).toUpperCase();
  }
}
