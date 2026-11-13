# order-service

피크오더 Order 서비스. 주문 생성·취소, 주문 상태 관리, Payment·Inventory·Cooking 연동 조정을 담당한다.

- 스택: Java 21, Spring Boot 4.1.2, Gradle, PostgreSQL(Flyway), RabbitMQ, springdoc-openapi
- 패키지: `com.peakorder.order` 아래 `controller / service / repository / dto / entity` (+ `config`, `exception`)
- 담당: 김민규

## 실행

로컬에는 PostgreSQL 16과 RabbitMQ 4.3이 필요하다. 접속 정보는 환경 변수로 주입하며, 비밀값은 저장소에 기록하지 않는다.
(`docker compose` 구성과 `.env.example`은 별도 PR로 추가할 예정이다.)

```bash
# 1) 로컬 PostgreSQL / RabbitMQ (<...> 는 본인이 정한 값으로 바꾼다)
docker run -d --name order-db -p 127.0.0.1:5432:5432 \
  -e POSTGRES_DB=order_db -e POSTGRES_USER=<사용자> -e POSTGRES_PASSWORD=<비밀번호> \
  postgres:16-alpine
docker run -d --name order-rabbitmq -p 127.0.0.1:5672:5672 -p 127.0.0.1:15672:15672 \
  -e RABBITMQ_DEFAULT_USER=<사용자> -e RABBITMQ_DEFAULT_PASS=<비밀번호> \
  rabbitmq:4.3-management-alpine

# 2) 같은 값을 환경 변수로 주입하고 실행
export DB_USER=<사용자> DB_PASSWORD=<비밀번호>
export RABBITMQ_USER=<사용자> RABBITMQ_PASSWORD=<비밀번호>
./gradlew bootRun
```

- 헬스체크: `GET /actuator/health`
- Swagger UI: `/swagger-ui.html`, OpenAPI: `/v3/api-docs`

## API (구현 완료)

| ID | Method | 경로 | 설명 |
|---|---|---|---|
| OR-01 | POST | `/api/v1/orders` | 임시 주문 생성 (매장 접수 확인 → Menu 검증 → 저장 → Inventory 재고 확보) |
| OR-03 | GET | `/api/v1/orders?page=0&size=20` | 본인 주문 목록 (CREATED·FAILED 제외, 최신순) |
| OR-04 | GET | `/api/v1/orders/{orderId}` | 본인 주문 상세 (타인 주문은 404) |

- 임시: 사용자 식별은 `X-User-Id` 헤더를 쓴다. 인증 방식이 확정되면 교체해야 한다(위조 가능).
- 매장은 기본 영업 종료·주문 미접수 상태이며, 접수 상태를 바꾸는 관리자 API(OR-07)는 아직 없다. 로컬 확인 시 `store_operations`를 직접 갱신한다.
- Menu·Inventory 내부 API의 요청·응답 필드는 초안이다(`client` 패키지 참고). 담당자와 합의 후 확정한다.

## 빌드·테스트

```bash
./gradlew spotlessCheck   # 포맷 검사 (google-java-format). 적용: ./gradlew spotlessApply
./gradlew test
./gradlew build
```

## 환경 변수

| 이름 | 설명 | 기본값 |
|---|---|---|
| `DB_URL` | JDBC URL | `jdbc:postgresql://localhost:5432/${DB_NAME:order_db}` |
| `DB_NAME` / `DB_USER` / `DB_PASSWORD` | DB 접속 정보 | (사용자·비밀번호는 필수) |
| `RABBITMQ_HOST` / `RABBITMQ_PORT` | RabbitMQ 주소 | `localhost` / `5672` |
| `RABBITMQ_USER` / `RABBITMQ_PASSWORD` | RabbitMQ 계정 | 필수 |
| `MENU_SERVICE_URL` | Menu Service 내부 주소 | `http://localhost:8081` |
| `INVENTORY_SERVICE_URL` | Inventory Service 내부 주소 | `http://localhost:8082` |

## 규칙

- DB 구조 변경은 Flyway 마이그레이션(`src/main/resources/db/migration`)으로만 한다. `ddl-auto`는 `none`.
- 응답은 공통 형식(`success`, `data`, `message`, 실패 시 `errorCode`).
