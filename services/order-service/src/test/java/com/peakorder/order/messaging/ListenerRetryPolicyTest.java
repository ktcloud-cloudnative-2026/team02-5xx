package com.peakorder.order.messaging;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.amqp.support.converter.MessageConversionException;
import org.springframework.dao.TransientDataAccessResourceException;
import tools.jackson.databind.json.JsonMapper;

class ListenerRetryPolicyTest {

  /** 리스너 컨테이너가 원인 예외를 한 겹 감싸서 던지는 상황을 흉내 낸다. */
  private RuntimeException wrap(Throwable cause) {
    return new RuntimeException("listener failed", cause);
  }

  @Test
  void malformed_json_is_not_retried_even_when_wrapped_by_the_listener_container() {
    Throwable jsonError = null;
    try {
      JsonMapper.builder().build().readTree("not-json");
    } catch (RuntimeException e) {
      jsonError = e;
    }

    assertThat(ListenerRetryPolicy.isRetryable(wrap(jsonError))).isFalse();
  }

  @Test
  void missing_required_fields_and_unprocessable_order_state_are_not_retried() {
    assertThat(ListenerRetryPolicy.isRetryable(wrap(new IllegalArgumentException("no ids"))))
        .isFalse();
    assertThat(ListenerRetryPolicy.isRetryable(wrap(new IllegalStateException("canceled"))))
        .isFalse();
    assertThat(ListenerRetryPolicy.isRetryable(new MessageConversionException("bad"))).isFalse();
  }

  @Test
  void transient_failures_are_retried() {
    assertThat(
            ListenerRetryPolicy.isRetryable(
                wrap(new TransientDataAccessResourceException("db connection lost"))))
        .isTrue();
  }
}
