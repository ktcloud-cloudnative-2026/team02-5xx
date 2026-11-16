package com.peakorder.cooking;

import com.peakorder.cooking.repository.CongestionThresholdRepository;
import com.peakorder.cooking.repository.CookingTicketRepository;
import com.peakorder.cooking.repository.OutboxEventRepository;
import com.peakorder.cooking.repository.ProcessedEventRepository;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/**
 * 애플리케이션 Bean 연결 검사.
 *
 * <p>테스트 설정(src/test/resources/application.yml)은 DB·JPA를 끄므로 Repository는 Mock으로 대체한다. Repository를
 * 새로 추가하면 여기에도 추가한다. 실제 SQL 검증은 DB를 쓰는 테스트(Testcontainers 등 도입 시)에서 한다.
 */
@SpringBootTest
class CookingServiceApplicationTests {

  @MockitoBean CookingTicketRepository cookingTicketRepository;
  @MockitoBean OutboxEventRepository outboxEventRepository;
  @MockitoBean ProcessedEventRepository processedEventRepository;
  @MockitoBean CongestionThresholdRepository congestionThresholdRepository;

  @Test
  void contextLoads() {}
}
