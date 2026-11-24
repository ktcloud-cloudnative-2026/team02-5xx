package com.peakorder.inventory.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.peakorder.inventory.config.AdminAuthInterceptor;
import com.peakorder.inventory.dto.StockItemResponse;
import com.peakorder.inventory.exception.GlobalExceptionHandler;
import com.peakorder.inventory.service.InventoryAdminService;
import com.peakorder.inventory.service.InventoryQueryService;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

/** 관리자 API의 신원 헤더 검사(#112 계약): 누락·형식 오류 401, 역할 부족 403. */
class AdminAuthorizationTest {

  private static final String LIST = "/api/v1/admin/inventory/items";

  private InventoryAdminService adminService;
  private InventoryQueryService queryService;
  private MockMvc mvc;

  @BeforeEach
  void setUp() {
    adminService = mock(InventoryAdminService.class);
    queryService = mock(InventoryQueryService.class);
    mvc =
        MockMvcBuilders.standaloneSetup(
                new InventoryAdminController(adminService), new InventoryController(queryService))
            .setControllerAdvice(new GlobalExceptionHandler())
            .addMappedInterceptors(new String[] {"/api/v1/admin/**"}, new AdminAuthInterceptor())
            .build();
  }

  private MockHttpServletRequestBuilder listAs(String userId, String role) {
    return get(LIST).header("X-User-Id", userId).header("X-User-Role", role);
  }

  @Test
  void 헤더가_없으면_401_공통_응답() throws Exception {
    mvc.perform(get(LIST))
        .andExpect(status().isUnauthorized())
        .andExpect(jsonPath("$.success").value(false))
        .andExpect(jsonPath("$.data").doesNotExist())
        .andExpect(jsonPath("$.message").isNotEmpty())
        .andExpect(jsonPath("$.errorCode").value("UNAUTHORIZED"));
    verifyNoInteractions(adminService);
  }

  @Test
  void 회원_ID가_숫자가_아니면_401() throws Exception {
    mvc.perform(listAs("abc", "STORE_ADMIN"))
        .andExpect(status().isUnauthorized())
        .andExpect(jsonPath("$.errorCode").value("UNAUTHORIZED"));
  }

  @Test
  void 회원_ID가_0이거나_공백이_있으면_401() throws Exception {
    mvc.perform(listAs("0", "STORE_ADMIN")).andExpect(status().isUnauthorized());
    mvc.perform(listAs(" 1", "STORE_ADMIN")).andExpect(status().isUnauthorized());
    mvc.perform(listAs("99999999999999999999", "STORE_ADMIN")).andExpect(status().isUnauthorized());
  }

  @Test
  void 역할이_소문자면_401() throws Exception {
    mvc.perform(listAs("1", "store_admin"))
        .andExpect(status().isUnauthorized())
        .andExpect(jsonPath("$.errorCode").value("UNAUTHORIZED"));
  }

  @Test
  void 정해지지_않은_역할이면_401() throws Exception {
    mvc.perform(listAs("1", "ADMIN"))
        .andExpect(status().isUnauthorized())
        .andExpect(jsonPath("$.errorCode").value("UNAUTHORIZED"));
  }

  @Test
  void 역할_헤더가_두_개면_401() throws Exception {
    mvc.perform(
            get(LIST)
                .header("X-User-Id", "1")
                .header("X-User-Role", "STORE_ADMIN")
                .header("X-User-Role", "STORE_ADMIN"))
        .andExpect(status().isUnauthorized());
    verifyNoInteractions(adminService);
  }

  @Test
  void 고객이면_403() throws Exception {
    mvc.perform(listAs("1", "CUSTOMER"))
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.success").value(false))
        .andExpect(jsonPath("$.errorCode").value("FORBIDDEN"));
    verifyNoInteractions(adminService);
  }

  @Test
  void 매장_관리자면_목록을_조회한다() throws Exception {
    when(adminService.list(anyBoolean())).thenReturn(List.of());

    mvc.perform(listAs("1", "STORE_ADMIN"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.success").value(true));
    verify(adminService).list(false);
  }

  @Test
  void 매장_관리자면_등록도_통과한다() throws Exception {
    when(adminService.create(any()))
        .thenReturn(new StockItemResponse(1L, null, 10, 0, 10, 2, false));

    mvc.perform(
            post(LIST)
                .header("X-User-Id", "1")
                .header("X-User-Role", "STORE_ADMIN")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"stockQty\":10,\"lowStockThreshold\":2}"))
        .andExpect(status().isCreated());
  }

  @Test
  void 고객_API는_헤더가_없어도_검사하지_않는다() throws Exception {
    when(queryService.availability(any())).thenReturn(List.of());

    mvc.perform(get("/api/v1/inventory/availability").param("menuIds", "1"))
        .andExpect(status().isOk());
  }
}
