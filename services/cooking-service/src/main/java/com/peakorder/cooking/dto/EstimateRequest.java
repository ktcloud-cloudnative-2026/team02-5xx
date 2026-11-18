package com.peakorder.cooking.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
import java.util.List;

/**
 * CO-02 요청. 장바구니의 메뉴·옵션·수량 (MI-01 요청과 같은 모양).
 *
 * <p>제한은 Order 주문 생성 요청(CreateOrderRequest)과 같다. 예상 시간이 나온 장바구니는 실제로 주문할 수 있어야 하기 때문이다 (PR #113
 * Codex 리뷰).
 *
 * @param items 1~20개
 */
public record EstimateRequest(@NotEmpty @Size(max = 20) List<@NotNull @Valid Item> items) {

  /**
   * @param quantity 1~99
   * @param optionIds 선택한 옵션 ID 최대 20개 (없으면 생략 가능, 중복 불가)
   */
  public record Item(
      @NotNull @Positive Long menuId,
      @NotNull @Positive @Max(99) Integer quantity,
      @Size(max = 20) List<@NotNull @Positive Long> optionIds) {

    public List<Long> optionIdsOrEmpty() {
      return optionIds == null ? List.of() : optionIds;
    }
  }
}
