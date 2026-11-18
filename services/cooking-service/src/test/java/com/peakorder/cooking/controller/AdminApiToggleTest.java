package com.peakorder.cooking.controller;

import static org.assertj.core.api.Assertions.assertThat;

import com.peakorder.cooking.repository.CongestionThresholdRepository;
import com.peakorder.cooking.repository.CookingTicketRepository;
import com.peakorder.cooking.repository.OutboxEventRepository;
import com.peakorder.cooking.repository.ProcessedEventRepository;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.ApplicationContext;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/** 관리자 API는 인증 연동 전까지 기본으로 꺼져 있고, 설정으로 켤 때만 등록되는지 확인한다(PR #53 리뷰). */
class AdminApiToggleTest {

  @Nested
  @SpringBootTest
  class 기본값 {

    @MockitoBean CookingTicketRepository cookingTicketRepository;
    @MockitoBean OutboxEventRepository outboxEventRepository;
    @MockitoBean ProcessedEventRepository processedEventRepository;
    @MockitoBean CongestionThresholdRepository congestionThresholdRepository;

    @Autowired ApplicationContext context;

    @Test
    void 관리자_API가_등록되지_않는다() {
      assertThat(context.getBeanNamesForType(CookingAdminController.class)).isEmpty();
    }
  }

  @Nested
  @SpringBootTest(properties = "cooking.admin.enabled=true")
  class 켰을_때 {

    @MockitoBean CookingTicketRepository cookingTicketRepository;
    @MockitoBean OutboxEventRepository outboxEventRepository;
    @MockitoBean ProcessedEventRepository processedEventRepository;
    @MockitoBean CongestionThresholdRepository congestionThresholdRepository;

    @Autowired ApplicationContext context;

    @Test
    void 관리자_API가_등록된다() {
      assertThat(context.getBeanNamesForType(CookingAdminController.class)).hasSize(1);
    }
  }
}
