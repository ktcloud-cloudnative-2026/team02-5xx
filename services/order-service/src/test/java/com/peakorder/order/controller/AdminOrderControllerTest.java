package com.peakorder.order.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.peakorder.order.dto.AdminOrderListResponse;
import com.peakorder.order.exception.BusinessException;
import com.peakorder.order.exception.ErrorCode;
import com.peakorder.order.exception.GlobalExceptionHandler;
import com.peakorder.order.service.AdminOrderService;
import java.time.LocalDate;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class AdminOrderControllerTest {

  private AdminOrderService service;
  private MockMvc mvc;

  @BeforeEach
  void setUp() {
    service = mock(AdminOrderService.class);
    mvc =
        MockMvcBuilders.standaloneSetup(new AdminOrderController(service))
            .setControllerAdvice(new GlobalExceptionHandler())
            .build();
  }

  @Test
  void search_passes_the_filters_and_returns_the_common_response_format() throws Exception {
    when(service.search(any(), any(), any(), any(), any(), eq(0), eq(20)))
        .thenReturn(new AdminOrderListResponse(List.of(), 0, 20, 0));

    mvc.perform(
            get("/api/v1/admin/orders")
                .param("from", "2026-11-01")
                .param("to", "2026-11-20")
                .param("orderNo", "261120-0001")
                .param("status", "CANCELED")
                .param("manualReviewRequired", "true"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.success").value(true))
        .andExpect(jsonPath("$.data.size").value(20));

    verify(service)
        .search(
            LocalDate.parse("2026-11-01"),
            LocalDate.parse("2026-11-20"),
            "261120-0001",
            "CANCELED",
            true,
            0,
            20);
  }

  @Test
  void search_without_filters_passes_nulls() throws Exception {
    when(service.search(any(), any(), any(), any(), any(), eq(0), eq(20)))
        .thenReturn(new AdminOrderListResponse(List.of(), 0, 20, 0));

    mvc.perform(get("/api/v1/admin/orders")).andExpect(status().isOk());

    verify(service).search(isNull(), isNull(), isNull(), isNull(), isNull(), eq(0), eq(20));
  }

  @Test
  void a_malformed_date_or_flag_is_a_bad_request_and_never_reaches_the_service() throws Exception {
    mvc.perform(get("/api/v1/admin/orders").param("from", "2026/11/01"))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errorCode").value("INVALID_REQUEST"));
    mvc.perform(get("/api/v1/admin/orders").param("to", "내일")).andExpect(status().isBadRequest());
    mvc.perform(get("/api/v1/admin/orders").param("manualReviewRequired", "maybe"))
        .andExpect(status().isBadRequest());
    mvc.perform(get("/api/v1/admin/orders").param("page", "abc"))
        .andExpect(status().isBadRequest());

    verify(service, never())
        .search(any(), any(), any(), any(), any(), any(Integer.class), any(Integer.class));
  }

  @Test
  void a_service_validation_error_is_a_bad_request() throws Exception {
    when(service.search(any(), any(), any(), any(), any(), eq(0), eq(20)))
        .thenThrow(new BusinessException(ErrorCode.INVALID_REQUEST));

    mvc.perform(get("/api/v1/admin/orders").param("status", "MAYBE"))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errorCode").value("INVALID_REQUEST"));
  }

  @Test
  void detail_of_a_missing_order_is_404() throws Exception {
    when(service.get(9L)).thenThrow(new BusinessException(ErrorCode.ORDER_NOT_FOUND));

    mvc.perform(get("/api/v1/admin/orders/9"))
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.errorCode").value("ORDER_NOT_FOUND"));
  }
}
