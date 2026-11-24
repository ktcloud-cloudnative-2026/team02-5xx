package com.peakorder.cooking.controller;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.peakorder.cooking.config.CurrentUserArgumentResolver;
import com.peakorder.cooking.exception.GlobalExceptionHandler;
import com.peakorder.cooking.service.CookingDashboardService;
import com.peakorder.cooking.service.CookingQueryService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

/**
 * CO-03·CO-04 관리자 API의 STORE_ADMIN 확인(#99, #112): 신원 헤더가 없거나 틀리면 401, STORE_ADMIN이 아니면 403이고, 이때 조회
 * 서비스는 호출되지 않는다. 토글(cooking.admin.enabled)로 등록 여부를 정하는 것은 {@link AdminApiToggleTest}가 확인한다.
 */
class CookingAdminControllerTest {

  private CookingQueryService queryService;
  private CookingDashboardService dashboardService;
  private MockMvc mvc;

  @BeforeEach
  void setUp() {
    queryService = mock(CookingQueryService.class);
    dashboardService = mock(CookingDashboardService.class);
    mvc =
        MockMvcBuilders.standaloneSetup(new CookingAdminController(queryService, dashboardService))
            .setControllerAdvice(new GlobalExceptionHandler())
            .setCustomArgumentResolvers(new CurrentUserArgumentResolver())
            .build();
  }

  @ParameterizedTest
  @ValueSource(strings = {"/api/v1/admin/cooking/overview", "/api/v1/admin/cooking/queue"})
  void store_admin_can_read(String path) throws Exception {
    mvc.perform(get(path).header("X-User-Id", "1").header("X-User-Role", "STORE_ADMIN"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.success").value(true));
  }

  @ParameterizedTest
  @ValueSource(strings = {"/api/v1/admin/cooking/overview", "/api/v1/admin/cooking/queue"})
  void missing_identity_headers_are_401_and_nothing_is_read(String path) throws Exception {
    mvc.perform(get(path))
        .andExpect(status().isUnauthorized())
        .andExpect(jsonPath("$.success").value(false))
        .andExpect(jsonPath("$.errorCode").value("UNAUTHORIZED"));
    verify(dashboardService, never()).getOverview();
    verify(queryService, never()).getQueue();
  }

  @ParameterizedTest
  @ValueSource(strings = {"/api/v1/admin/cooking/overview", "/api/v1/admin/cooking/queue"})
  void a_customer_is_403_and_nothing_is_read(String path) throws Exception {
    mvc.perform(get(path).header("X-User-Id", "42").header("X-User-Role", "CUSTOMER"))
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.success").value(false))
        .andExpect(jsonPath("$.errorCode").value("FORBIDDEN"));
    verify(dashboardService, never()).getOverview();
    verify(queryService, never()).getQueue();
  }
}
