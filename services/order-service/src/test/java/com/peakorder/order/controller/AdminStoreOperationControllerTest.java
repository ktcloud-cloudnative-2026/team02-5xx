package com.peakorder.order.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.peakorder.order.config.CurrentUserArgumentResolver;
import com.peakorder.order.dto.StoreOperationResponse;
import com.peakorder.order.dto.UpdateStoreOperationRequest;
import com.peakorder.order.exception.BusinessException;
import com.peakorder.order.exception.ErrorCode;
import com.peakorder.order.exception.GlobalExceptionHandler;
import com.peakorder.order.service.StoreOperationService;
import java.time.OffsetDateTime;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class AdminStoreOperationControllerTest {

  private StoreOperationService service;
  private MockMvc mvc;

  /** Gateway를 거치지 않은 것처럼 신원 헤더 없이 호출하는 MockMvc */
  private MockMvc withoutIdentity;

  @BeforeEach
  void setUp() {
    service = mock(StoreOperationService.class);
    // 기본 요청에 STORE_ADMIN 신원 헤더를 붙여 기존 테스트가 관리자로 호출하게 한다
    mvc =
        MockMvcBuilders.standaloneSetup(new AdminStoreOperationController(service))
            .setControllerAdvice(new GlobalExceptionHandler())
            .setCustomArgumentResolvers(new CurrentUserArgumentResolver())
            .defaultRequest(get("/").header("X-User-Id", 1).header("X-User-Role", "STORE_ADMIN"))
            .build();
    withoutIdentity =
        MockMvcBuilders.standaloneSetup(new AdminStoreOperationController(service))
            .setControllerAdvice(new GlobalExceptionHandler())
            .setCustomArgumentResolvers(new CurrentUserArgumentResolver())
            .build();
  }

  private StoreOperationResponse state(boolean open, boolean accepting) {
    return new StoreOperationResponse(
        open, accepting, OffsetDateTime.parse("2026-11-19T10:00:00+09:00"));
  }

  @Test
  void get_returns_the_state_in_the_common_response_format() throws Exception {
    when(service.get()).thenReturn(state(true, false));

    mvc.perform(get("/api/v1/admin/store/operations"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.success").value(true))
        .andExpect(jsonPath("$.data.isOpen").value(true))
        .andExpect(jsonPath("$.data.acceptingOrders").value(false))
        .andExpect(jsonPath("$.data.updatedAt").value("2026-11-19T10:00:00+09:00"));
  }

  @Test
  void patch_with_one_field_passes_only_that_field_on() throws Exception {
    when(service.update(any())).thenReturn(state(true, false));

    mvc.perform(
            patch("/api/v1/admin/store/operations")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"isOpen\":true}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.message").value("영업·접수 상태가 변경되었습니다."))
        .andExpect(jsonPath("$.data.isOpen").value(true));
  }

  @Test
  void patch_with_nothing_to_change_is_a_bad_request() throws Exception {
    when(service.update(any())).thenThrow(new BusinessException(ErrorCode.INVALID_REQUEST));

    mvc.perform(
            patch("/api/v1/admin/store/operations")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{}"))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errorCode").value("INVALID_REQUEST"));
  }

  @Test
  void patch_with_a_value_that_is_not_a_boolean_is_a_bad_request() throws Exception {
    mvc.perform(
            patch("/api/v1/admin/store/operations")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"isOpen\":\"maybe\"}"))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.success").value(false));
  }

  @Test
  void patch_does_not_coerce_strings_or_numbers_into_booleans() throws Exception {
    for (String field : new String[] {"isOpen", "acceptingOrders"}) {
      for (String value : new String[] {"\"true\"", "\"false\"", "1", "0", "[]", "{}"}) {
        mvc.perform(
                patch("/api/v1/admin/store/operations")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("{\"" + field + "\":" + value + "}"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.errorCode").value("INVALID_REQUEST"));
      }
    }
    verify(service, never()).update(any());
  }

  @Test
  void patch_accepts_json_booleans() throws Exception {
    when(service.update(any())).thenReturn(state(true, false));
    mvc.perform(
            patch("/api/v1/admin/store/operations")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"isOpen\":true,\"acceptingOrders\":false}"))
        .andExpect(status().isOk());
    verify(service).update(new UpdateStoreOperationRequest(true, false));
  }

  @Test
  void patch_without_a_body_is_a_bad_request() throws Exception {
    mvc.perform(patch("/api/v1/admin/store/operations").contentType(MediaType.APPLICATION_JSON))
        .andExpect(status().isBadRequest());
  }

  @Test
  void both_apis_reject_missing_identity_with_401() throws Exception {
    withoutIdentity
        .perform(get("/api/v1/admin/store/operations"))
        .andExpect(status().isUnauthorized())
        .andExpect(jsonPath("$.errorCode").value("UNAUTHORIZED"));
    withoutIdentity
        .perform(
            patch("/api/v1/admin/store/operations")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"isOpen\":true}"))
        .andExpect(status().isUnauthorized());
    verifyNoInteractions(service);
  }

  @Test
  void customer_cannot_use_the_admin_apis_403() throws Exception {
    withoutIdentity
        .perform(
            get("/api/v1/admin/store/operations")
                .header("X-User-Id", 7)
                .header("X-User-Role", "CUSTOMER"))
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.errorCode").value("FORBIDDEN"));
    withoutIdentity
        .perform(
            patch("/api/v1/admin/store/operations")
                .header("X-User-Id", 7)
                .header("X-User-Role", "CUSTOMER")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"isOpen\":true}"))
        .andExpect(status().isForbidden());
    verifyNoInteractions(service);
  }
}
