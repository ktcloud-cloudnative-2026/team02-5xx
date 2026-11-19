package com.peakorder.order.dto;

import tools.jackson.databind.annotation.JsonDeserialize;

/** OR-07 요청. 보낸 항목만 바꾸며 둘 다 비어 있으면 400이다. 값은 JSON 불린(true·false)만 허용한다. */
public record UpdateStoreOperationRequest(
    @JsonDeserialize(using = StrictBooleanDeserializer.class) Boolean isOpen,
    @JsonDeserialize(using = StrictBooleanDeserializer.class) Boolean acceptingOrders) {

  public boolean isEmpty() {
    return isOpen == null && acceptingOrders == null;
  }
}
