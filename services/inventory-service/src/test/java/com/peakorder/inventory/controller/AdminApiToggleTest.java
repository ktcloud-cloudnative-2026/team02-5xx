package com.peakorder.inventory.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

import com.peakorder.inventory.config.AdminWebConfig;
import com.peakorder.inventory.service.InventoryAdminService;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

/** 관리자 API는 인증 연동 전까지 기본으로 꺼져 있고, 설정으로 켤 때만 등록되는지 확인한다(PR #143 리뷰). */
class AdminApiToggleTest {

  private final ApplicationContextRunner runner =
      new ApplicationContextRunner()
          .withBean(InventoryAdminService.class, () -> mock(InventoryAdminService.class))
          .withUserConfiguration(InventoryAdminController.class, AdminWebConfig.class);

  @Test
  void 기본값이면_관리자_API가_등록되지_않는다() {
    runner.run(context -> assertThat(context).doesNotHaveBean(InventoryAdminController.class));
  }

  @Test
  void 켜면_관리자_API가_등록된다() {
    runner
        .withPropertyValues("inventory.admin.enabled=true")
        .run(context -> assertThat(context).hasSingleBean(InventoryAdminController.class));
  }

  @Test
  void 기본값이면_관리자_권한_검사_설정도_등록되지_않는다() {
    runner.run(context -> assertThat(context).doesNotHaveBean(AdminWebConfig.class));
  }

  @Test
  void 켜면_관리자_권한_검사_설정이_등록된다() {
    runner
        .withPropertyValues("inventory.admin.enabled=true")
        .run(context -> assertThat(context).hasSingleBean(AdminWebConfig.class));
  }
}
