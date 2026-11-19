package com.peakorder.cooking.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.peakorder.cooking.client.MenuClient;
import com.peakorder.cooking.client.MenuClient.PurchaseLine;
import com.peakorder.cooking.client.MenuClient.ValidatedMenu;
import com.peakorder.cooking.client.MenuClient.ValidatedOption;
import com.peakorder.cooking.dto.CongestionResponse;
import com.peakorder.cooking.dto.EstimateRequest;
import com.peakorder.cooking.dto.EstimateResponse;
import com.peakorder.cooking.exception.BusinessException;
import com.peakorder.cooking.exception.ErrorCode;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

class CookingEstimateServiceTest {

  private MenuClient menuClient;
  private CookingDashboardService dashboardService;
  private CookingEstimateService service;

  @BeforeEach
  void setUp() {
    menuClient = mock(MenuClient.class);
    dashboardService = mock(CookingDashboardService.class);
    service = new CookingEstimateService(menuClient, dashboardService);
    when(dashboardService.getCongestion())
        .thenReturn(new CongestionResponse(CongestionResponse.Level.NORMAL, 2, 1, 444));
  }

  @Test
  void 조리_시간은_기본과_옵션_추가_시간의_합에_수량을_곱해_더한다() {
    when(menuClient.validatePurchase(any()))
        .thenReturn(
            List.of(
                new ValidatedMenu(1L, "아메리카노", 120, List.of(new ValidatedOption(10L, "샷 추가", 30))),
                new ValidatedMenu(2L, "라떼", 90, List.of())));
    EstimateRequest request =
        new EstimateRequest(
            List.of(
                new EstimateRequest.Item(1L, 2, List.of(10L)),
                new EstimateRequest.Item(2L, 1, null)));

    EstimateResponse res = service.estimate(request);

    // OrderConfirmed 합의 예시와 같은 계산: (120+30)×2 + 90×1 = 390
    assertThat(res).isEqualTo(new EstimateResponse(444, 390, 444 + 390));
  }

  @Test
  void 옵션이_없으면_빈_목록으로_Menu에_요청한다() {
    when(menuClient.validatePurchase(any()))
        .thenReturn(List.of(new ValidatedMenu(2L, "라떼", 90, List.of())));

    service.estimate(new EstimateRequest(List.of(new EstimateRequest.Item(2L, 1, null))));

    @SuppressWarnings("unchecked")
    ArgumentCaptor<List<PurchaseLine>> captor = ArgumentCaptor.forClass(List.class);
    verify(menuClient).validatePurchase(captor.capture());
    assertThat(captor.getValue().get(0).optionIds()).isEmpty();
  }

  @Test
  void 중복_옵션은_Menu를_부르기_전에_INVALID_REQUEST() {
    EstimateRequest request =
        new EstimateRequest(List.of(new EstimateRequest.Item(1L, 1, List.of(10L, 10L))));

    assertThatThrownBy(() -> service.estimate(request))
        .extracting(e -> ((BusinessException) e).errorCode())
        .isEqualTo(ErrorCode.INVALID_REQUEST);
    verify(menuClient, never()).validatePurchase(any());
  }

  @Test
  void Menu_실패는_그대로_전달한다() {
    when(menuClient.validatePurchase(any()))
        .thenThrow(new BusinessException(ErrorCode.MENU_NOT_AVAILABLE));

    assertThatThrownBy(() ->
            service.estimate(
                new EstimateRequest(List.of(new EstimateRequest.Item(1L, 1, List.of())))))
        .extracting(e -> ((BusinessException) e).errorCode())
        .isEqualTo(ErrorCode.MENU_NOT_AVAILABLE);
  }
}
