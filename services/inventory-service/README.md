# inventory-service

피크오더 Inventory 서비스. 메뉴별 재고와 품절 여부를 관리하고, 주문 결제 과정의 재고 임시 확보·확정·반환·복원을 담당한다.

- 스택: Java 21, Spring Boot 4.1.2, Gradle, PostgreSQL(Flyway), springdoc-openapi
- 패키지: `com.peakorder.inventory` 아래 `controller / service / repository / dto / entity` (+ `config`, `exception`)
- 담당: 남규리

## 실행

로컬에는 PostgreSQL 16이 필요하다. 접속 정보는 환경 변수로 주입하며, 비밀값은 저장소에 기록하지 않는다.

```bash
# 1) 로컬 PostgreSQL (<...> 는 본인이 정한 값으로 바꾼다)
docker run -d --name inventory-db -p 127.0.0.1:5432:5432 \
  -e POSTGRES_DB=inventory_db -e POSTGRES_USER=<사용자> -e POSTGRES_PASSWORD=<비밀번호> \
  postgres:16-alpine

# 2) 같은 값을 환경 변수로 주입하고 실행
export DB_USER=<사용자> DB_PASSWORD=<비밀번호>
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
| `DB_URL` | JDBC URL | `jdbc:postgresql://localhost:5432/${DB_NAME:inventory_db}` |
| `DB_NAME` / `DB_USER` / `DB_PASSWORD` | DB 접속 정보 | (사용자·비밀번호는 필수) |
| `STOCK_HOLD_TTL` | 재고 임시 확보 유효시간 | `5m` (테스트 환경은 `10s`) |

## 테이블 (Flyway V1)

| 테이블 | 내용 |
|---|---|
| `inventories` | 메뉴별 실제 재고(`stock_qty`)와 임시 확보 수량 합(`reserved_qty`). 주문 가능 수량 = `stock_qty - reserved_qty` |
| `inventory_reservations` | 임시 주문(`order_id`)당 확보 1건. 상태 `RESERVED → CONFIRMED / RELEASED / EXPIRED`, 확정 후 취소 시 `CONFIRMED → RESTORED` |
| `inventory_reservation_items` | 확보 건의 메뉴별 수량 |
| `inventory_histories` | 재고 변동 이력 (`RESERVE`, `CONFIRM`, `RELEASE`, `RESTORE`, `RESTOCK`, `ADJUST`) |

## 규칙

- DB 구조 변경은 Flyway 마이그레이션(`src/main/resources/db/migration`)으로만 한다. `ddl-auto`는 `none`.
- 응답은 공통 형식(`success`, `data`, `message`, 실패 시 `errorCode`).
