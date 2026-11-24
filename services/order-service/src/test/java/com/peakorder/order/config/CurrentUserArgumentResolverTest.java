package com.peakorder.order.config;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.peakorder.order.exception.GlobalExceptionHandler;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Gateway가 전달하는 {@code X-User-Id}·{@code X-User-Role} 처리 규칙(#112, #263): 없거나 형식이 틀리면 401, 역할이 다르면
 * 403, 통과하면 사용자 ID.
 */
class CurrentUserArgumentResolverTest {

  /** 해석기만 확인하려는 최소 컨트롤러 */
  @RestController
  static class Probe {
    @GetMapping("/customer")
    String customer(@CurrentUser(UserRole.CUSTOMER) Long userId) {
      return "customer:" + userId;
    }

    @GetMapping("/admin")
    String admin(@CurrentUser(UserRole.STORE_ADMIN) Long userId) {
      return "admin:" + userId;
    }
  }

  private MockMvc mvc;

  @BeforeEach
  void setUp() {
    mvc =
        MockMvcBuilders.standaloneSetup(new Probe())
            .setControllerAdvice(new GlobalExceptionHandler())
            .setCustomArgumentResolvers(new CurrentUserArgumentResolver())
            .build();
  }

  @Test
  void valid_customer_headers_pass_the_user_id_through() throws Exception {
    mvc.perform(get("/customer").header("X-User-Id", "42").header("X-User-Role", "CUSTOMER"))
        .andExpect(status().isOk())
        .andExpect(content().string("customer:42"));
  }

  @Test
  void valid_store_admin_headers_reach_the_admin_endpoint() throws Exception {
    mvc.perform(get("/admin").header("X-User-Id", "1").header("X-User-Role", "STORE_ADMIN"))
        .andExpect(status().isOk())
        .andExpect(content().string("admin:1"));
  }

  @Test
  void the_largest_id_that_fits_in_a_long_is_accepted() throws Exception {
    mvc.perform(
            get("/customer")
                .header("X-User-Id", "999999999999999999")
                .header("X-User-Role", "CUSTOMER"))
        .andExpect(status().isOk())
        .andExpect(content().string("customer:999999999999999999"));
  }

  @Test
  void missing_headers_are_401_in_the_common_failure_format() throws Exception {
    mvc.perform(get("/customer"))
        .andExpect(status().isUnauthorized())
        .andExpect(jsonPath("$.success").value(false))
        .andExpect(jsonPath("$.errorCode").value("UNAUTHORIZED"));
    mvc.perform(get("/customer").header("X-User-Id", "42")).andExpect(status().isUnauthorized());
    mvc.perform(get("/customer").header("X-User-Role", "CUSTOMER"))
        .andExpect(status().isUnauthorized());
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "",
        " ",
        "abc",
        "0",
        "-1",
        "+1",
        "007",
        "4 2",
        " 42",
        "42 ",
        "1,2",
        "1.5",
        "0x10",
        "٤٢",
        "1000000000000000000"
      })
  void a_user_id_that_is_not_a_plain_positive_integer_is_401(String userId) throws Exception {
    mvc.perform(get("/customer").header("X-User-Id", userId).header("X-User-Role", "CUSTOMER"))
        .andExpect(status().isUnauthorized())
        .andExpect(jsonPath("$.errorCode").value("UNAUTHORIZED"));
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "",
        "customer",
        "Customer",
        "store_admin",
        "ADMIN",
        "ROLE_CUSTOMER",
        "CUSTOMER,STORE_ADMIN",
        "CUSTOMER "
      })
  void a_role_other_than_the_two_values_is_401(String role) throws Exception {
    mvc.perform(get("/customer").header("X-User-Id", "42").header("X-User-Role", role))
        .andExpect(status().isUnauthorized())
        .andExpect(jsonPath("$.errorCode").value("UNAUTHORIZED"));
  }

  @Test
  void a_header_sent_twice_is_401_even_if_both_values_are_valid() throws Exception {
    mvc.perform(get("/customer").header("X-User-Id", "42", "42").header("X-User-Role", "CUSTOMER"))
        .andExpect(status().isUnauthorized());
    mvc.perform(
            get("/customer")
                .header("X-User-Id", "42")
                .header("X-User-Role", "CUSTOMER", "CUSTOMER"))
        .andExpect(status().isUnauthorized());
    mvc.perform(
            get("/admin")
                .header("X-User-Id", "42")
                .header("X-User-Role", "STORE_ADMIN", "CUSTOMER"))
        .andExpect(status().isUnauthorized());
  }

  @Test
  void a_valid_role_that_the_endpoint_does_not_allow_is_403() throws Exception {
    mvc.perform(get("/admin").header("X-User-Id", "42").header("X-User-Role", "CUSTOMER"))
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.success").value(false))
        .andExpect(jsonPath("$.errorCode").value("FORBIDDEN"));
    mvc.perform(get("/customer").header("X-User-Id", "42").header("X-User-Role", "STORE_ADMIN"))
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.errorCode").value("FORBIDDEN"));
  }

  @Test
  void a_malformed_id_is_401_even_when_the_role_would_be_forbidden() throws Exception {
    // 형식 오류(401)를 역할 불일치(403)보다 먼저 판단한다
    mvc.perform(get("/admin").header("X-User-Id", "abc").header("X-User-Role", "CUSTOMER"))
        .andExpect(status().isUnauthorized());
  }
}
