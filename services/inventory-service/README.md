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
| `INVENTORY_EXPIRY_CHECK_DELAY_MS` | 만료 스케줄러 실행 간격(ms). 한 번 돈 뒤 이만큼 쉬고 다시 실행 | `5000` |

## 내부 API (Order → Inventory)

| ID | Method | 경로 | 동작 |
|---|---|---|---|
| II-01 | POST | `/internal/v1/inventory/holds` | 재고 임시 확보. 요청 `{"orderId":1,"items":[{"menuId":10,"quantity":2}]}`, 응답 `{holdId, expiresAt}` |
| II-02 | POST | `/internal/v1/inventory/holds/{holdId}/confirm` | 확보 확정. `stock_qty`·`reserved_qty` 함께 차감 |
| II-03 | DELETE | `/internal/v1/inventory/holds/{holdId}` | 확보 해제. `reserved_qty`만 차감 |
| II-04 | POST | `/internal/v1/inventory/restorations` | 확정 후 취소 시 복원. 요청 `{"orderId":1}`, 응답 `{orderId, restored}`. `stock_qty`만 증가 |

| ID | 이미 처리된 경우 (200) | 오류 |
|---|---|---|
| II-01 | 같은 `orderId`면 기존 확보 반환 | 409 `INSUFFICIENT_STOCK`, 409 `STOCK_NOT_LINKED` |
| II-02 | 이미 `CONFIRMED` | 409 `HOLD_NOT_ACTIVE`(만료·해제), 404 `HOLD_NOT_FOUND` |
| II-03 | 이미 `RELEASED`·`EXPIRED` | 409 `HOLD_NOT_ACTIVE`(확정됨), 404 `HOLD_NOT_FOUND` |
| II-04 | 이미 `RESTORED` | 409 `RESTORE_NOT_APPLICABLE`(확정된 확보 없음) |

- 확보·재고 행은 비관적 락으로 잠그며, 교착 방지를 위해 메뉴 ID 순서로 잠근다.
- 만료 스케줄러는 `expires_at`이 지난 `RESERVED` 확보를 `EXPIRED`로 바꾸고 `reserved_qty`를 되돌린다. 처리 직전 상태를 다시 확인하므로 그 사이 확정된 확보는 건드리지 않는다.

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
