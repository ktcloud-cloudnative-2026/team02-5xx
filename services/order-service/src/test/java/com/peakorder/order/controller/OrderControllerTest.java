package com.peakorder.order.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.peakorder.order.config.CurrentUserArgumentResolver;
import com.peakorder.order.dto.OrderDetailResponse;
import com.peakorder.order.entity.OrderStatus;
import com.peakorder.order.exception.BusinessException;
import com.peakorder.order.exception.ErrorCode;
import com.peakorder.order.exception.GlobalExceptionHandler;
import com.peakorder.order.service.OrderCancelService;
import com.peakorder.order.service.OrderService;
import java.time.OffsetDateTime;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.validation.beanvalidation.LocalValidatorFactoryBean;

class OrderControllerTest {

  private OrderService orderService;
  private OrderCancelService cancelService;
  private MockMvc mvc;

  @BeforeEach
  void setUp() {
    orderService = mock(OrderService.class);
    cancelService = mock(OrderCancelService.class);
    LocalValidatorFactoryBean validator = new LocalValidatorFactoryBean();
    validator.afterPropertiesSet();
    mvc =
        MockMvcBuilders.standaloneSetup(new OrderController(orderService, cancelService))
            .setControllerAdvice(new GlobalExceptionHandler())
            .setCustomArgumentResolvers(new CurrentUserArgumentResolver())
            .setValidator(validator)
            .build();
  }

  private OrderDetailResponse detail() {
    return new OrderDetailResponse(
        100L,
        null,
        OrderStatus.CREATED,
        7000,
        null,
        OffsetDateTime.parse("2026-11-13T10:00:00+09:00"),
        null,
        null,
        null,
        OffsetDateTime.parse("2026-11-13T10:05:00+09:00"),
        List.of(),
        null);
  }

  @Test
  void create_returns_201_in_common_format() throws Exception {
    when(orderService.createOrder(eq(7L), any())).thenReturn(detail());

    mvc.perform(
            post("/api/v1/orders")
                .header("X-User-Id", 7)
                .header("X-User-Role", "CUSTOMER")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"items\":[{\"menuId\":1,\"quantity\":2,\"optionIds\":[10]}]}"))
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.success").value(true))
        .andExpect(jsonPath("$.data.orderId").value(100))
        .andExpect(jsonPath("$.data.status").value("CREATED"))
        .andExpect(jsonPath("$.data.orderNo").doesNotExist());
  }

  @Test
  void create_with_invalid_quantity_is_400_common_failure() throws Exception {
    mvc.perform(
            post("/api/v1/orders")
                .header("X-User-Id", 7)
                .header("X-User-Role", "CUSTOMER")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"items\":[{\"menuId\":1,\"quantity\":0}]}"))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.success").value(false))
        .andExpect(jsonPath("$.errorCode").value("INVALID_REQUEST"));
  }

  @Test
  void create_with_empty_items_is_400() throws Exception {
    mvc.perform(
            post("/api/v1/orders")
                .header("X-User-Id", 7)
                .header("X-User-Role", "CUSTOMER")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"items\":[]}"))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errorCode").value("INVALID_REQUEST"));
  }

  @Test
  void missing_user_header_is_401() throws Exception {
    // 신원 헤더가 없으면 요청 형식 오류(400)가 아니라 인증 실패(401)다(#112, #263)
    mvc.perform(get("/api/v1/orders/1"))
        .andExpect(status().isUnauthorized())
        .andExpect(jsonPath("$.errorCode").value("UNAUTHORIZED"));
  }

  @Test
  void out_of_stock_is_409() throws Exception {
    when(orderService.createOrder(eq(7L), any()))
        .thenThrow(new BusinessException(ErrorCode.OUT_OF_STOCK));

    mvc.perform(
            post("/api/v1/orders")
                .header("X-User-Id", 7)
                .header("X-User-Role", "CUSTOMER")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"items\":[{\"menuId\":1,\"quantity\":1}]}"))
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.errorCode").value("OUT_OF_STOCK"));
  }

  @Test
  void get_unknown_order_is_404() throws Exception {
    when(orderService.getOrder(7L, 5L)).thenThrow(new BusinessException(ErrorCode.ORDER_NOT_FOUND));

    mvc.perform(get("/api/v1/orders/5").header("X-User-Id", 7).header("X-User-Role", "CUSTOMER"))
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.errorCode").value("ORDER_NOT_FOUND"));
  }

  @Test
  void pay_returns_200_with_confirmed_order() throws Exception {
    OrderDetailResponse confirmed =
        new OrderDetailResponse(
            100L,
            "261113-0001",
            OrderStatus.PAID,
            7000,
            null,
            OffsetDateTime.parse("2026-11-13T10:00:00+09:00"),
            OffsetDateTime.parse("2026-11-13T10:01:00+09:00"),
            null,
            null,
            null,
            List.of(),
            null);
    when(orderService.payOrder(7L, 100L)).thenReturn(confirmed);

    mvc.perform(
            post("/api/v1/orders/100/pay").header("X-User-Id", 7).header("X-User-Role", "CUSTOMER"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.success").value(true))
        .andExpect(jsonPath("$.data.orderNo").value("261113-0001"))
        .andExpect(jsonPath("$.data.status").value("PAID"))
        .andExpect(jsonPath("$.data.holdExpiresAt").doesNotExist());
  }

  @Test
  void pay_failure_is_402_and_unknown_payment_is_503() throws Exception {
    when(orderService.payOrder(7L, 100L))
        .thenThrow(new BusinessException(ErrorCode.PAYMENT_FAILED));
    when(orderService.payOrder(7L, 101L))
        .thenThrow(new BusinessException(ErrorCode.PAYMENT_SERVICE_UNAVAILABLE));

    mvc.perform(
            post("/api/v1/orders/100/pay").header("X-User-Id", 7).header("X-User-Role", "CUSTOMER"))
        .andExpect(status().isPaymentRequired())
        .andExpect(jsonPath("$.errorCode").value("PAYMENT_FAILED"));
    mvc.perform(
            post("/api/v1/orders/101/pay").header("X-User-Id", 7).header("X-User-Role", "CUSTOMER"))
        .andExpect(status().isServiceUnavailable())
        .andExpect(jsonPath("$.errorCode").value("PAYMENT_SERVICE_UNAVAILABLE"));
  }

  @Test
  void cancel_returns_the_canceled_order_in_the_common_response_format() throws Exception {
    when(cancelService.cancelOrder(7L, 100L)).thenReturn(detail());

    mvc.perform(
            post("/api/v1/orders/100/cancel")
                .header("X-User-Id", 7)
                .header("X-User-Role", "CUSTOMER"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.success").value(true))
        .andExpect(jsonPath("$.message").value("주문이 취소되었습니다."))
        .andExpect(jsonPath("$.data.orderId").value(100));
  }

  @Test
  void cancel_rejection_is_reported_with_its_error_code_and_status() throws Exception {
    when(cancelService.cancelOrder(7L, 100L))
        .thenThrow(new BusinessException(ErrorCode.COOKING_ALREADY_STARTED));

    mvc.perform(
            post("/api/v1/orders/100/cancel")
                .header("X-User-Id", 7)
                .header("X-User-Role", "CUSTOMER"))
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.success").value(false))
        .andExpect(jsonPath("$.errorCode").value("COOKING_ALREADY_STARTED"));
  }

  /** 고객 API 다섯 개를 각각 한 번씩 호출하는 요청(요청 본문은 유효하다) */
  private List<MockHttpServletRequestBuilder> allCustomerRequests() {
    return List.of(
        post("/api/v1/orders")
            .contentType(MediaType.APPLICATION_JSON)
            .content("{\"items\":[{\"menuId\":1,\"quantity\":2,\"optionIds\":[10]}]}"),
        post("/api/v1/orders/100/pay"),
        post("/api/v1/orders/100/cancel"),
        get("/api/v1/orders"),
        get("/api/v1/orders/100"));
  }

  @Test
  void every_customer_api_rejects_missing_identity_with_401_and_never_calls_the_service()
      throws Exception {
    for (MockHttpServletRequestBuilder request : allCustomerRequests()) {
      mvc.perform(request)
          .andExpect(status().isUnauthorized())
          .andExpect(jsonPath("$.success").value(false))
          .andExpect(jsonPath("$.errorCode").value("UNAUTHORIZED"));
    }
    verifyNoInteractions(orderService, cancelService);
  }

  @Test
  void user_id_without_role_or_role_without_user_id_is_401() throws Exception {
    for (MockHttpServletRequestBuilder request : allCustomerRequests()) {
      mvc.perform(request.header("X-User-Id", 7)).andExpect(status().isUnauthorized());
    }
    for (MockHttpServletRequestBuilder request : allCustomerRequests()) {
      mvc.perform(request.header("X-User-Role", "CUSTOMER")).andExpect(status().isUnauthorized());
    }
    verifyNoInteractions(orderService, cancelService);
  }

  @Test
  void malformed_identity_is_401_for_every_customer_api() throws Exception {
    for (MockHttpServletRequestBuilder request : allCustomerRequests()) {
      mvc.perform(request.header("X-User-Id", "abc").header("X-User-Role", "CUSTOMER"))
          .andExpect(status().isUnauthorized());
    }
    for (MockHttpServletRequestBuilder request : allCustomerRequests()) {
      mvc.perform(request.header("X-User-Id", 7).header("X-User-Role", "customer"))
          .andExpect(status().isUnauthorized());
    }
    verifyNoInteractions(orderService, cancelService);
  }

  @Test
  void store_admin_cannot_use_the_customer_api_403() throws Exception {
    for (MockHttpServletRequestBuilder request : allCustomerRequests()) {
      mvc.perform(request.header("X-User-Id", 7).header("X-User-Role", "STORE_ADMIN"))
          .andExpect(status().isForbidden())
          .andExpect(jsonPath("$.success").value(false))
          .andExpect(jsonPath("$.errorCode").value("FORBIDDEN"));
    }
    verifyNoInteractions(orderService, cancelService);
  }

  @Test
  void identity_is_checked_before_the_request_body() throws Exception {
    // 본문이 잘못돼도 신원이 없으면 400이 아니라 401이다
    mvc.perform(post("/api/v1/orders").contentType(MediaType.APPLICATION_JSON).content("{}"))
        .andExpect(status().isUnauthorized());
  }
}
