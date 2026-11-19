package com.peakorder.order.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

import com.peakorder.order.service.StoreOperationService;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

/** 인증 방식이 정해지기 전(#112)에는 관리자 API가 기본으로 등록되지 않아야 한다. */
class AdminStoreOperationExposureTest {

  private final ApplicationContextRunner runner =
      new ApplicationContextRunner()
          .withBean(StoreOperationService.class, () -> mock(StoreOperationService.class))
          .withUserConfiguration(AdminStoreOperationController.class);

  @Test
  void the_admin_controller_is_not_registered_by_default() {
    runner.run(context -> assertThat(context).doesNotHaveBean(AdminStoreOperationController.class));
  }

  @Test
  void the_admin_controller_is_not_registered_when_the_flag_is_false() {
    runner
        .withPropertyValues("order.admin.enabled=false")
        .run(context -> assertThat(context).doesNotHaveBean(AdminStoreOperationController.class));
  }

  @Test
  void the_admin_controller_is_registered_only_when_the_flag_is_true() {
    runner
        .withPropertyValues("order.admin.enabled=true")
        .run(context -> assertThat(context).hasSingleBean(AdminStoreOperationController.class));
  }
}
