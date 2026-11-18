package com.peakorder.cooking.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
import java.util.List;

/**
 * CO-02 요청. 장바구니의 메뉴·옵션·수량 (MI-01 요청과 같은 모양).
 *
 * @param items 1~50개
 */
public record EstimateRequest(@NotEmpty @Size(max = 50) List<@NotNull @Valid Item> items) {

  /**
   * @param optionIds 선택한 옵션 ID (없으면 생략 가능, 중복 불가)
   */
  public record Item(
      @NotNull @Positive Long menuId,
      @NotNull @Positive Integer quantity,
      List<@NotNull @Positive Long> optionIds) {

    public List<Long> optionIdsOrEmpty() {
      return optionIds == null ? List.of() : optionIds;
    }
  }
}
