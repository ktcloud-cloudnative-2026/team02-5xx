package com.peakorder.order.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.peakorder.order.dto.OrderDetailResponse;
import com.peakorder.order.entity.OrderStatus;
import com.peakorder.order.exception.BusinessException;
import com.peakorder.order.exception.ErrorCode;
import com.peakorder.order.exception.GlobalExceptionHandler;
import com.peakorder.order.service.OrderService;
import java.time.OffsetDateTime;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.validation.beanvalidation.LocalValidatorFactoryBean;

class OrderControllerTest {

  private OrderService orderService;
  private MockMvc mvc;

  @BeforeEach
  void setUp() {
    orderService = mock(OrderService.class);
    LocalValidatorFactoryBean validator = new LocalValidatorFactoryBean();
    validator.afterPropertiesSet();
    mvc =
        MockMvcBuilders.standaloneSetup(new OrderController(orderService))
            .setControllerAdvice(new GlobalExceptionHandler())
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
        List.of());
  }

  @Test
  void create_returns_201_in_common_format() throws Exception {
    when(orderService.createOrder(eq(7L), any())).thenReturn(detail());

    mvc.perform(
            post("/api/v1/orders")
                .header("X-User-Id", 7)
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
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"items\":[]}"))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errorCode").value("INVALID_REQUEST"));
  }

  @Test
  void missing_user_header_is_400() throws Exception {
    mvc.perform(get("/api/v1/orders/1")).andExpect(status().isBadRequest());
  }

  @Test
  void out_of_stock_is_409() throws Exception {
    when(orderService.createOrder(eq(7L), any()))
        .thenThrow(new BusinessException(ErrorCode.OUT_OF_STOCK));

    mvc.perform(
            post("/api/v1/orders")
                .header("X-User-Id", 7)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"items\":[{\"menuId\":1,\"quantity\":1}]}"))
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.errorCode").value("OUT_OF_STOCK"));
  }

  @Test
  void get_unknown_order_is_404() throws Exception {
    when(orderService.getOrder(7L, 5L)).thenThrow(new BusinessException(ErrorCode.ORDER_NOT_FOUND));

    mvc.perform(get("/api/v1/orders/5").header("X-User-Id", 7))
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.errorCode").value("ORDER_NOT_FOUND"));
  }
}
