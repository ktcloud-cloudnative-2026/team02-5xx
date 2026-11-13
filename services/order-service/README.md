# order-service

피크오더 Order 서비스. 주문 생성·취소, 주문 상태 관리, Payment·Inventory·Cooking 연동 조정을 담당한다.

- 스택: Java 21, Spring Boot 4.1.2, Gradle, PostgreSQL(Flyway), RabbitMQ, springdoc-openapi
- 패키지: `com.peakorder.order` 아래 `controller / service / repository / dto / entity` (+ `config`, `exception`)
- 담당: 김민규

## 실행

```bash
# 로컬 PostgreSQL / RabbitMQ (비밀값은 .env 에서 주입, .env 는 커밋하지 않음)
cp .env.example .env   # 값 채움
docker compose up -d

set -a && . ./.env && set +a
./gradlew bootRun
```

- 헬스체크: `GET /actuator/health`
- Swagger UI: `/swagger-ui.html`, OpenAPI: `/v3/api-docs`

## 빌드·테스트

```bash
./gradlew build
```

## 환경 변수

| 이름 | 설명 | 기본값 |
|---|---|---|
| `DB_URL` | JDBC URL | `jdbc:postgresql://localhost:5432/${DB_NAME:order_db}` |
| `DB_NAME` / `DB_USER` / `DB_PASSWORD` | DB 접속 정보 | (사용자·비밀번호는 필수) |
| `RABBITMQ_HOST` / `RABBITMQ_PORT` | RabbitMQ 주소 | `localhost` / `5672` |
| `RABBITMQ_USER` / `RABBITMQ_PASSWORD` | RabbitMQ 계정 | 필수 |

## 규칙

- DB 구조 변경은 Flyway 마이그레이션(`src/main/resources/db/migration`)으로만 한다. `ddl-auto`는 `none`.
- 응답은 공통 형식(`success`, `data`, `message`, 실패 시 `errorCode`).
