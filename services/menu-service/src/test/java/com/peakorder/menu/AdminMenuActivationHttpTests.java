package com.peakorder.menu;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.request;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.peakorder.menu.controller.*;
import com.peakorder.menu.exception.AdminMenuExceptionHandler;
import com.peakorder.menu.service.*;
import java.util.stream.Stream;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.http.HttpMethod;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import tools.jackson.databind.ObjectMapper;

/** Local identity inputs exercise the real policy, not Gateway or JWT authentication. */
class AdminMenuActivationHttpTests {
  static Stream<Arguments> attempts() {
    return Stream.of(
            "GET /api/v1/admin/menus",
            "GET /api/v1/admin/menus/1",
            "POST /api/v1/admin/menus",
            "PATCH /api/v1/admin/menus/1",
            "PATCH /api/v1/admin/menus/1/status")
        .flatMap(
            endpoint ->
                Stream.of(
                        "disabled",
                        "missing",
                        "only-id",
                        "only-role",
                        "bad-id",
                        "unicode-id",
                        "duplicate-id",
                        "duplicate-role",
                        "comma-id",
                        "comma-role",
                        "bad-role",
                        "customer",
                        "bearer",
                        "servlet")
                    .map(input -> Arguments.of(endpoint, input)));
  }

  @ParameterizedTest
  @MethodSource("attempts")
  void denialPrecedesBodyParsingAndBusinessWork(String endpoint, String input) throws Exception {
    var query = mock(AdminMenuQueryService.class);
    var create = mock(AdminMenuCreateService.class);
    var update = mock(MenuUpdateService.class);
    var sale = mock(MenuStatusService.class);
    var authorization =
        new AdminMenuAuthorization(new AdminMenuActivation(!input.equals("disabled")));
    var mapper = new ObjectMapper();
    var mvc =
        MockMvcBuilders.standaloneSetup(
                new AdminMenuController(query, authorization),
                new AdminMenuCreateController(create, authorization, mapper),
                new MenuUpdateController(update, authorization, mapper),
                new MenuStatusController(sale, authorization, mapper))
            .setControllerAdvice(new AdminMenuExceptionHandler())
            .build();
    var parts = endpoint.split(" ");
    var builder =
        request(HttpMethod.valueOf(parts[0]), parts[1])
            .contentType("application/json")
            .content("{");
    if (!Stream.of("missing", "only-role", "bearer", "servlet").anyMatch(input::equals))
      builder.header(
          "X-User-Id",
          input.equals("comma-id")
              ? "42,42"
              : input.equals("bad-id") ? "0" : input.equals("unicode-id") ? "１" : "42");
    if (!Stream.of("missing", "only-id", "bearer", "servlet").anyMatch(input::equals))
      builder.header(
          "X-User-Role",
          input.equals("comma-role")
              ? "STORE_ADMIN,CUSTOMER"
              : input.equals("customer")
                  ? "CUSTOMER"
                  : input.equals("bad-role") ? "store_admin" : "STORE_ADMIN");
    if (input.equals("duplicate-id")) builder.header("x-user-id", "42");
    if (input.equals("duplicate-role")) builder.header("x-USER-role", "STORE_ADMIN");
    if (input.equals("bearer") || input.equals("disabled"))
      builder.header("Authorization", "Bearer unverified.payload.signature");
    if (input.equals("servlet") || input.equals("disabled"))
      builder
          .principal(() -> "claimed-admin")
          .with(
              req -> {
                req.addUserRole("STORE_ADMIN");
                return req;
              });
    int expected = input.equals("disabled") || input.equals("customer") ? 403 : 401;
    mvc.perform(builder)
        .andExpect(status().is(expected))
        .andExpect(jsonPath("$.success").value(false))
        .andExpect(jsonPath("$.errorCode").value(expected == 401 ? "UNAUTHORIZED" : "FORBIDDEN"));
    verifyNoInteractions(query, create, update, sale);
  }
}
