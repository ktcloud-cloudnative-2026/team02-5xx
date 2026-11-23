# cooking-service

주문 확정(OrderConfirmed) 이벤트로 조리 전표를 만들고, 자동 조리 진행·취소(CI-03)·예상 시간(CI-02, CO-01·02)을 제공하는 Cooking 서비스다. 배포 구성은 [`deploy/apps/cooking-service/README.md`](../../deploy/apps/cooking-service/README.md)를 본다. 실행·API·이벤트 설명은 추가 예정이다.

## 빌드·테스트

```bash
./gradlew spotlessCheck   # 포맷 검사 (google-java-format). 적용: ./gradlew spotlessApply
./gradlew test            # 단위 테스트 + 통합 테스트(Docker가 있을 때)
./gradlew build
```

- 단위 테스트는 DB·RabbitMQ 없이 돈다. 테스트 설정(`src/test/resources/application.yml`)이 DB 자동 설정을 끄고 Repository는 Mock으로 대체한다.

### 통합 테스트 (실제 PostgreSQL, #114)

행 잠금(`SELECT … FOR UPDATE`)·advisory lock은 DB가 하는 동작이라 모의 테스트로는 확인할 수 없어, 취소·자동 조리 경합과 다중 인스턴스 동작은 실제 PostgreSQL에서 검증한다.

- **Docker가 필요하다.** Testcontainers가 `postgres:16.16`(dev·로컬과 같은 버전)을 띄우고 Flyway V1~V3를 적용한 뒤, 끝나면 지운다. Docker가 없으면 이 테스트는 건너뛴다(실패 아님). CI(ubuntu-24.04)에는 Docker가 있어 `./gradlew test`에서 함께 실행된다.
- 통합 테스트만 실행: `./gradlew test --tests '*RaceIntegrationTest'`
- 처음 실행할 때는 PostgreSQL 이미지를 내려받느라 조금 더 걸린다.

| 시나리오 | 확인하는 것 | 결과 (2026-11-23) |
|---|---|---|
| 1. 취소(CI-03)와 자동 조리 `tick()` 동시 실행 (20회) | 한 전표가 취소와 조리 시작 중 **한쪽만** 반영됨 | 통과 |
| 2. 취소가 먼저 잠금 (5회) | `tick()`이 잠금을 기다린 뒤 그 전표를 건너뛰고 **같은 tick에서** 다음 WAITING 전표를 시작 | 통과 (약 0.5초 대기) |
| 2-반대. 조리 시작이 먼저 잠금 (5회) | 취소가 기다린 뒤 409 `COOKING_ALREADY_STARTED` | 통과 |
| 3. `tick()` 두 개 동시 실행 (10회) | advisory lock으로 한쪽만 실행 → 예외 없이 COOKING 1건 (다중 Pod·HPA 대비) | 통과 |

**통합 테스트를 새로 만들 때**
- 클래스에 `@Tag("integration")`, `@Testcontainers(disabledWithoutDocker = true)`를 붙인다.
- 테스트 설정이 끈 DB 자동 설정을 그 클래스에서만 다시 켠다: `@SpringBootTest(properties = {"spring.autoconfigure.exclude=", "spring.jpa.hibernate.ddl-auto=validate"})`. 스키마는 Flyway로만 만든다.
- 컨테이너는 `@Container @ServiceConnection static PostgreSQLContainer`(패키지 `org.testcontainers.postgresql`, Testcontainers 2.x)로 선언하면 접속 정보가 자동으로 연결된다.
- 예시: `src/test/java/com/peakorder/cooking/service/CookingRaceIntegrationTest.java`
