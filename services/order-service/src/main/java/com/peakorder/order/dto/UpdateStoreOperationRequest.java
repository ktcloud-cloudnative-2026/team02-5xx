package com.peakorder.order.dto;

/** OR-07 요청. 보낸 항목만 바꾸며 둘 다 비어 있으면 400이다. */
public record UpdateStoreOperationRequest(Boolean isOpen, Boolean acceptingOrders) {

  public boolean isEmpty() {
    return isOpen == null && acceptingOrders == null;
  }
}
