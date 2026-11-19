package com.peakorder.order.dto;

import tools.jackson.core.JsonParser;
import tools.jackson.core.JsonToken;
import tools.jackson.databind.DeserializationContext;
import tools.jackson.databind.ValueDeserializer;

/**
 * JSON의 {@code true}·{@code false}만 받는다. Jackson 기본 동작은 문자열 {@code "true"}나 숫자 {@code 1}도 불린으로 바꿔
 * 주는데, 상태를 바꾸는 요청에서는 의도하지 않은 입력이 변경에 쓰이지 않도록 거절한다(400). JSON {@code null}은 이 클래스까지 오지 않고 항목 생략과 같게
 * 취급된다.
 */
public class StrictBooleanDeserializer extends ValueDeserializer<Boolean> {

  @Override
  public Boolean deserialize(JsonParser parser, DeserializationContext context) {
    JsonToken token = parser.currentToken();
    if (token == JsonToken.VALUE_TRUE) {
      return Boolean.TRUE;
    }
    if (token == JsonToken.VALUE_FALSE) {
      return Boolean.FALSE;
    }
    return (Boolean) context.handleUnexpectedToken(Boolean.class, parser);
  }
}
