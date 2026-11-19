package com.peakorder.cooking.dto;

import static org.assertj.core.api.Assertions.assertThat;

import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validation;
import jakarta.validation.Validator;
import jakarta.validation.ValidatorFactory;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Set;
import java.util.stream.LongStream;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

/** CO-02 요청 검증: 잘못된 입력은 Menu를 부르기 전에 400으로 거절되어야 한다(500이 아니라). */
class EstimateRequestValidationTest {

  private static ValidatorFactory factory;
  private static Validator validator;

  @BeforeAll
  static void setUp() {
    factory = Validation.buildDefaultValidatorFactory();
    validator = factory.getValidator();
  }

  @AfterAll
  static void tearDown() {
    factory.close();
  }

  private static Set<ConstraintViolation<EstimateRequest>> validate(
      List<EstimateRequest.Item> items) {
    return validator.validate(new EstimateRequest(items));
  }

  @Test
  void 정상_요청은_통과한다() {
    assertThat(validate(List.of(new EstimateRequest.Item(1L, 2, List.of(10L))))).isEmpty();
  }

  @Test
  void 항목에_null이_있으면_거절한다() {
    // {"items":[null]} — 검증을 통과하면 서비스에서 NPE로 500이 난다 (PR #109 Codex 리뷰)
    assertThat(validate(Arrays.asList((EstimateRequest.Item) null))).isNotEmpty();
  }

  @Test
  void 빈_목록_수량_0_옵션_ID_null은_거절한다() {
    assertThat(validate(List.of())).isNotEmpty();
    assertThat(validate(List.of(new EstimateRequest.Item(1L, 0, null)))).isNotEmpty();
    assertThat(validate(List.of(new EstimateRequest.Item(1L, 1, Arrays.asList(10L, null)))))
        .isNotEmpty();
  }

  @Test
  void Order_주문_요청과_같은_제한을_적용한다() {
    // 예상 시간이 나온 장바구니는 Order에서도 주문할 수 있어야 한다 (PR #113 Codex 리뷰, Order CreateOrderRequest)
    EstimateRequest.Item one = new EstimateRequest.Item(1L, 1, null);
    assertThat(validate(Collections.nCopies(20, one))).isEmpty();
    assertThat(validate(Collections.nCopies(21, one))).isNotEmpty();

    assertThat(validate(List.of(new EstimateRequest.Item(1L, 99, null)))).isEmpty();
    assertThat(validate(List.of(new EstimateRequest.Item(1L, 100, null)))).isNotEmpty();

    List<Long> twentyOptions = LongStream.rangeClosed(1, 20).boxed().toList();
    List<Long> twentyOneOptions = LongStream.rangeClosed(1, 21).boxed().toList();
    assertThat(validate(List.of(new EstimateRequest.Item(1L, 1, twentyOptions)))).isEmpty();
    assertThat(validate(List.of(new EstimateRequest.Item(1L, 1, twentyOneOptions)))).isNotEmpty();
  }
}
