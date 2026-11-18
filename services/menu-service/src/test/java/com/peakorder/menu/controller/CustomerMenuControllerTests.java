package com.peakorder.menu.controller;

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.not;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.peakorder.menu.dto.CustomerMenuDetailResponse;
import com.peakorder.menu.dto.CustomerMenuListResponse;
import com.peakorder.menu.entity.MenuStatus;
import com.peakorder.menu.exception.CustomerMenuExceptionHandler;
import com.peakorder.menu.exception.CustomerMenuNotFoundException;
import com.peakorder.menu.exception.CustomerMenuQueryException;
import com.peakorder.menu.service.CustomerMenuQueryService;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class CustomerMenuControllerTests {
  private final CustomerMenuQueryService service = mock(CustomerMenuQueryService.class);
  private final MockMvc mvc =
      MockMvcBuilders.standaloneSetup(new CustomerMenuController(service))
          .setControllerAdvice(new CustomerMenuExceptionHandler())
          .build();

  @Test
  void listResponseContainsCategoriesAndVisibleMenuWithoutAuthentication() throws Exception {
    when(service.list(null, null, null))
        .thenReturn(
            new CustomerMenuListResponse(
                List.of(new CustomerMenuListResponse.CategoryItem(1L, "Burgers")),
                List.of(
                    new CustomerMenuListResponse.MenuItem(
                        10L, 1L, "Burger", null, 6500, MenuStatus.ON_SALE))));

    mvc.perform(get("/api/v1/menus"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.success").value(true))
        .andExpect(jsonPath("$.data.categories[0].name").value("Burgers"))
        .andExpect(jsonPath("$.data.menus[0].basePrice").value(6500))
        .andExpect(jsonPath("$.data.menus[0].status").value("ON_SALE"));
  }

  @Test
  void detailedResponseIncludesInactiveAndDefaultOptions() throws Exception {
    when(service.detail("10"))
        .thenReturn(
            new CustomerMenuDetailResponse(
                10L,
                1L,
                "Burger",
                null,
                null,
                6500,
                MenuStatus.PAUSED,
                List.of(new CustomerMenuDetailResponse.OptionItem(31L, "Set", 2500, true, false))));

    mvc.perform(get("/api/v1/menus/10"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.status").value("PAUSED"))
        .andExpect(jsonPath("$.data.options[0].isDefault").value(true))
        .andExpect(jsonPath("$.data.options[0].active").value(false));
  }

  @Test
  void invalidCategoryAndSortReturnSharedErrorFormat() throws Exception {
    when(service.list("bad", null, null))
        .thenThrow(new CustomerMenuQueryException("invalid categoryId"));
    when(service.list(null, null, "wrong"))
        .thenThrow(new CustomerMenuQueryException("invalid sort"));

    mvc.perform(get("/api/v1/menus").param("categoryId", "bad"))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errorCode").value("INVALID_REQUEST"));
    mvc.perform(get("/api/v1/menus").param("sort", "wrong"))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errorCode").value("INVALID_REQUEST"));
  }

  @Test
  void missingAndHiddenHaveIdenticalNotFoundError() throws Exception {
    when(service.detail("9")).thenThrow(new CustomerMenuNotFoundException());

    mvc.perform(get("/api/v1/menus/9"))
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.errorCode").value("MENU_NOT_FOUND"))
        .andExpect(jsonPath("$.message").value("Menu not found"));
  }

  @Test
  void databaseErrorsDoNotLeakToPublicApi() throws Exception {
    when(service.detail("7"))
        .thenThrow(new DataAccessResourceFailureException("private secret connection info"));

    mvc.perform(get("/api/v1/menus/7"))
        .andExpect(status().isInternalServerError())
        .andExpect(jsonPath("$.errorCode").value("INTERNAL_ERROR"))
        .andExpect(jsonPath("$.message", not(containsString("private secret"))));
  }
}
