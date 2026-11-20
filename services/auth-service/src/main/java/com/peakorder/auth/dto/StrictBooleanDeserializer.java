package com.peakorder.auth.dto;

import tools.jackson.core.JsonParser;
import tools.jackson.core.JsonToken;
import tools.jackson.databind.DeserializationContext;
import tools.jackson.databind.ValueDeserializer;

public class StrictBooleanDeserializer extends ValueDeserializer<Boolean> {
  @Override
  public Boolean getAbsentValue(DeserializationContext context) {
    return null;
  }

  @Override
  public Boolean getNullValue(DeserializationContext context) {
    return context.reportInputMismatch(Boolean.class, "rememberMe must be a JSON boolean");
  }

  @Override
  public Boolean deserialize(JsonParser parser, DeserializationContext context) {
    if (parser.currentToken() == JsonToken.VALUE_TRUE) return true;
    if (parser.currentToken() == JsonToken.VALUE_FALSE) return false;
    return (Boolean) context.handleUnexpectedToken(Boolean.class, parser);
  }
}
