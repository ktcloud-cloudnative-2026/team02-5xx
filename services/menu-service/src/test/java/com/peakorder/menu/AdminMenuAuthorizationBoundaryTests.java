package com.peakorder.menu;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.peakorder.menu.controller.AdminMenuController;
import com.peakorder.menu.exception.AdminMenuExceptionHandler;
import com.peakorder.menu.service.AdminMenuAuthorization;
import com.peakorder.menu.service.AdminMenuQueryService;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class AdminMenuAuthorizationBoundaryTests {
  @ParameterizedTest
  @ValueSource(strings = {"/api/v1/admin/menus", "/api/v1/admin/menus/1"})
  void servletPrincipalAndRoleAloneDoNotEstablishTheMissingTrustContract(String path)
      throws Exception {
    var service = mock(AdminMenuQueryService.class);
    var mvc =
        MockMvcBuilders.standaloneSetup(
                new AdminMenuController(
                    service,
                    new AdminMenuAuthorization(
                        new com.peakorder.menu.service.AdminMenuActivation(false))))
            .setControllerAdvice(new AdminMenuExceptionHandler())
            .build();
    // This injected servlet identity is not a reviewed, connected authentication mechanism.
    mvc.perform(
            get(path)
                .principal(() -> "claimed-admin")
                .with(
                    request -> {
                      request.addUserRole("STORE_ADMIN");
                      return request;
                    }))
        .andExpect(status().isForbidden());
    verifyNoInteractions(service);
  }
}
