# payment-service

피크오더 Payment 서비스. 결제 승인·취소(환불), 결제 상태 관리를 담당한다.

- 스택: Java 21, Spring Boot 4.1.2, Gradle, PostgreSQL(Flyway), RabbitMQ, springdoc-openapi
- 패키지: `com.peakorder.payment` 아래 `controller / service / repository / dto / entity` (+ `config`, `exception`)
- 담당: 정진혁

## 실행

로컬에는 PostgreSQL 16과 RabbitMQ 4.3이 필요하다. 접속 정보는 환경 변수로 주입하며, 비밀값은 저장소에 기록하지 않는다.
(`docker compose` 구성과 `.env.example`은 별도 PR로 추가할 예정이다.)

```bash
# 1) 로컬 PostgreSQL / RabbitMQ (<...> 는 본인이 정한 값으로 바꾼다)
docker run -d --name payment-db -p 127.0.0.1:5432:5432 \
  -e POSTGRES_DB=payment_db -e POSTGRES_USER=<사용자> -e POSTGRES_PASSWORD=<비밀번호> \
  postgres:16-alpine
docker run -d --name payment-rabbitmq -p 127.0.0.1:5672:5672 -p 127.0.0.1:15672:15672 \
  -e RABBITMQ_DEFAULT_USER=<사용자> -e RABBITMQ_DEFAULT_PASS=<비밀번호> \
  rabbitmq:4.3-management-alpine

# 2) 같은 값을 환경 변수로 주입하고 실행
export DB_USER=<사용자> DB_PASSWORD=<비밀번호>
export RABBITMQ_USER=<사용자> RABBITMQ_PASSWORD=<비밀번호>
./gradlew bootRun
```

- 헬스체크: `GET /actuator/health`
- Swagger UI: `/swagger-ui.html`, OpenAPI: `/v3/api-docs`

## 빌드·테스트

```bash
./gradlew spotlessCheck   # 포맷 검사 (google-java-format). 적용: ./gradlew spotlessApply
./gradlew test
./gradlew build
```

## 환경 변수

| 이름 | 설명 | 기본값 |
|---|---|---|
| `DB_URL` | JDBC URL | `jdbc:postgresql://localhost:5432/${DB_NAME:payment_db}` |
| `DB_NAME` / `DB_USER` / `DB_PASSWORD` | DB 접속 정보 | (사용자·비밀번호는 필수) |
| `RABBITMQ_HOST` / `RABBITMQ_PORT` | RabbitMQ 주소 | `localhost` / `5672` |
| `RABBITMQ_USER` / `RABBITMQ_PASSWORD` | RabbitMQ 계정 | 필수 |

## 규칙

- DB 구조 변경은 Flyway 마이그레이션(`src/main/resources/db/migration`)으로만 한다. `ddl-auto`는 `none`.
- 응답은 공통 형식(`success`, `data`, `message`, 실패 시 `errorCode`).
- 요청 값 검증 오류(400 `INVALID_REQUEST`)의 `message`는 DTO에 적은 한글 문구를 그대로 쓴다(예: `amount는 0보다 커야 합니다.`). 새 필드를 추가할 때도 검증 애너테이션에 `message`를 한글로 적는다.

## 실제 PG로 바꿀 때 (메모)

지금은 모의 결제라 승인 결과가 즉시 나오므로 **승인 → 결과 저장** 순서로 한 번에 처리한다(`REQUESTED` 상태를 쓰지 않음).
실제 PG(외부 결제 대행사)로 바꾸면 이 순서를 그대로 두면 안 된다.

- 바꿀 순서: **`REQUESTED` 행을 먼저 저장 → PG 승인 요청 → 결과에 따라 `APPROVED`/`FAILED`로 갱신**
- 이유: 지금 순서대로면 PG에서 돈이 빠져나간 뒤 저장 전에 서버가 죽었을 때 **결제 기록이 하나도 남지 않는다**. 먼저 남겨 둔 `REQUESTED` 행이 있어야 "결과를 모르는 결제"를 찾아 PG에 다시 조회하고 정리할 수 있다.
- 함께 필요한 것: `REQUESTED`로 오래 남은 결제를 PG에 다시 조회하는 확인 작업, PG 승인 요청의 시간 초과 처리, PG 쪽 멱등 키(지금의 `idempotencyKey`) 전달.
- DB 구조는 이미 `REQUESTED` 상태를 허용하므로 마이그레이션은 필요 없을 것으로 본다(전환 시 다시 확인).
