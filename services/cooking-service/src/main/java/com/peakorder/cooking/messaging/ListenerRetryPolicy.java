package com.peakorder.cooking.messaging;

import org.springframework.amqp.support.converter.MessageConversionException;
import tools.jackson.core.JacksonException;

/**
 * 수신 메시지 처리 실패 시 재시도 여부를 판단한다 (Order #51과 같은 기준). 다시 시도해도 결과가 같은 오류(형식 오류, 필수값 누락, 잘못된 상태)는 재시도 없이
 * 바로 DLQ로 보내고, 일시적일 수 있는 오류(DB 연결 문제 등)만 재시도한다.
 */
public final class ListenerRetryPolicy {

  private ListenerRetryPolicy() {}

  /** 원인 예외를 따라가며 재시도해도 소용없는 오류가 있는지 확인한다. */
  public static boolean isRetryable(Throwable error) {
    for (Throwable t = error; t != null; t = t.getCause()) {
      if (t instanceof JacksonException
          || t instanceof MessageConversionException
          || t instanceof IllegalArgumentException
          || t instanceof IllegalStateException) {
        return false;
      }
      if (t.getCause() == t) {
        break;
      }
    }
    return true;
  }
}
