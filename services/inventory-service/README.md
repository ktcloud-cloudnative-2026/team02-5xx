# inventory-service

피크오더 Inventory 서비스. 메뉴별 재고와 품절 여부를 관리하고, 주문 결제 과정의 재고 임시 확보·확정·반환·복원을 담당한다.

- 스택: Java 21, Spring Boot 4.1.2, Gradle, PostgreSQL(Flyway), springdoc-openapi
- 패키지: `com.peakorder.inventory` 아래 `controller / service / repository / dto / entity` (+ `client`, `config`, `exception`)
- 담당: 남규리
- Redis: 사용하지 않는다. 재고 확보 만료는 DB `inventory_reservations.expires_at` 기준 스케줄러(기본 5초 간격)가 처리한다.

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
| `MENU_SERVICE_URL` | Menu 서비스 주소. IN-05에서 MI-02(메뉴 존재 확인) 호출에 사용. 연결 2초·응답 3초 제한 | `http://localhost:8081` |
| `INVENTORY_ADMIN_ENABLED` | 관리자 API(IN-02~06) 등록 여부. `STORE_ADMIN` 권한 검사는 적용됐고, 공유 dev에서 켜는 것은 Gateway JWT 검증 확인 뒤. 꺼져 있으면 관리자 경로 404 | `false` |

## 로그

- K8s에서는 `LOGGING_STRUCTURED_FORMAT_CONSOLE=ecs`(base Deployment)로 stdout에 ECS JSON 한 줄씩 남긴다(docs/observability.md 3절). 로컬은 기존 텍스트 로그.
- 재고 상태가 **실제로 바뀐 경우에만**, 트랜잭션이 **커밋된 뒤** INFO 한 줄을 남긴다(문장 + `key=value`). 같은 호출의 재시도(멱등)·거절·조회는 남기지 않는다.
  - II-01~04·만료: `재고 확보 orderId=1 holdId=10 items=11x2`, `재고 확보 확정|해제|만료 orderId=1 holdId=10`, `재고 복원 orderId=1 holdId=10`
  - 관리자: `재고 항목 등록 stockItemId=5 stockQty=10`, `재고 추가 stockItemId=5 quantity=3 stockQty=13`, `재고 메뉴 연결 stockItemId=5 menuId=7`, `재고 메뉴 연결 해제 stockItemId=5 previousMenuId=7`, `재고 항목 삭제 stockItemId=5 previousMenuId=7`
- Loki에서는 `{app="inventory-service"} |= "orderId=1"`로 따라간다.

## 외부 API (프론트 → Inventory)

| ID | Method | 경로 | 동작 |
|---|---|---|---|
| IN-01 | GET | `/api/v1/inventory/availability?menuIds=1,2,3` | 메뉴별 재고 기준 주문 가능 여부. 응답 `[{menuId, orderable, availableQty}]` |
| IN-02 | GET | `/api/v1/admin/inventory/items?lowStockOnly=false` | 재고 항목 목록(삭제 제외, id순). `lowStockOnly=true`면 부족(가용 ≤ 기준치)한 것만 |
| IN-03 | POST | `/api/v1/admin/inventory/items` | 재고 항목 등록(메뉴 미연결). 요청 `{stockQty, lowStockThreshold}`, 201 |
| IN-04 | POST | `/api/v1/admin/inventory/items/{stockItemId}/adjustments` | 재고 추가. 요청 `{quantity}` (1 이상만) |
| IN-05 | PUT | `/api/v1/admin/inventory/items/{stockItemId}/menu-link` | 메뉴 연결. 요청 `{menuId}`, `null`이면 연결 해제 |
| IN-06 | DELETE | `/api/v1/admin/inventory/items/{stockItemId}` | 재고 항목 논리 삭제 |

- IN-02는 재고 항목 목록을, IN-03~06은 바뀐 재고 항목 `{stockItemId, menuId, stockQty, reservedQty, availableQty, lowStockThreshold, lowStock}`을 돌려준다.
- IN-01의 `orderable`은 재고 기준만 본다(연결됨 + 주문 가능 수량 1 이상). 메뉴 판매 상태와의 결합은 프론트가 한다. 미연결 메뉴는 오류가 아니라 `false`. 잠금 없이 읽는다. `menuIds`가 없거나 숫자가 아니거나 0 이하이거나 100개를 넘으면 400.
- IN-05 오류: 없는 메뉴 404 `MENU_NOT_FOUND`, 숨김 메뉴 409 `MENU_NOT_LINKABLE`, 이미 다른 재고에 연결된 메뉴 409 `MENU_ALREADY_LINKED`(동시에 같은 메뉴를 연결해도 409 `MENU_ALREADY_LINKED`), 현재 메뉴로 결제 대기(`RESERVED`)이거나 복원될 수 있는 확정(`CONFIRMED`) 주문이 있으면 409 `STOCK_ITEM_IN_USE`, Menu 장애 503 `MENU_SERVICE_UNAVAILABLE`(기존 연결 유지). ON_SALE·PAUSED 메뉴는 연결할 수 있다.
- 관리자 API는 `INVENTORY_ADMIN_ENABLED=true`일 때만 등록된다(기본 꺼짐, 꺼져 있으면 404). 공유 dev·prod에서는 Gateway JWT 검증을 확인하고 관리자 경로 노출을 정하기 전까지 켜지 않는다.
- 관리자 API 권한 검사: 신원 헤더는 Gateway가 JWT 검증 후 넣는다(#112). 서비스는 값을 변환·추측하지 않는다.
  - `X-User-Id`: 정확히 1개, 앞뒤 공백 없는 양의 정수(long 범위)
  - `X-User-Role`: 정확히 1개, `CUSTOMER` 또는 `STORE_ADMIN`과 정확히 일치(대소문자 구분)

| 상황 | 응답 |
|---|---|
| 신원 헤더 누락, 형식 오류, 같은 헤더 여러 개, 정해지지 않은 역할 | 401 `UNAUTHORIZED` |
| 역할이 `CUSTOMER` | 403 `FORBIDDEN` |
| 역할이 `STORE_ADMIN` | 통과 |

- IN-02는 삭제되지 않은 재고만 id순으로 잠금 없이 읽는다. `lowStockOnly`(기본 `false`)가 `true`면 부족한 것만.
- IN-06은 행을 지우지 않고 `deleted_at`을 기록한 뒤 메뉴 연결을 푼다(그 메뉴는 다른 재고에 다시 연결할 수 있다). 연결된 메뉴로 결제 대기(`RESERVED`)이거나 복원될 수 있는 확정(`CONFIRMED`) 주문이 있으면 409 `STOCK_ITEM_IN_USE`, 없거나 이미 삭제된 재고는 404 `INVENTORY_NOT_FOUND`. 삭제된 재고는 IN-01·IN-02·IN-04·IN-05·II-01~04에서 없는 것으로 본다.

## 내부 API (Order → Inventory)

| ID | Method | 경로 | 동작 |
|---|---|---|---|
| II-01 | POST | `/internal/v1/inventory/holds` | 재고 임시 확보. 요청 `{"orderId":1,"items":[{"menuId":10,"quantity":2}]}`, 응답 `{holdId, expiresAt}` |
| II-02 | POST | `/internal/v1/inventory/holds/{holdId}/confirm` | 확보 확정. `stock_qty`·`reserved_qty` 함께 차감 |
| II-03 | DELETE | `/internal/v1/inventory/holds/{holdId}` | 확보 해제. `reserved_qty`만 차감 |
| II-04 | POST | `/internal/v1/inventory/restorations` | 확정 후 취소 시 복원. 요청 `{"orderId":1}`, 응답 `{orderId, restored}`. `stock_qty`만 증가 |

| ID | 이미 처리된 경우 (200) | 오류 |
|---|---|---|
| II-01 | 같은 `orderId`면 기존 확보 반환(같은 orderId 동시 요청도 같은 확보를 돌려준다) | 409 `INSUFFICIENT_STOCK`, 409 `STOCK_NOT_LINKED` |
| II-02 | 이미 `CONFIRMED` | 409 `HOLD_NOT_ACTIVE`(만료·해제), 404 `HOLD_NOT_FOUND` |
| II-03 | 이미 `RELEASED`·`EXPIRED` | 409 `HOLD_NOT_ACTIVE`(확정됨), 404 `HOLD_NOT_FOUND` |
| II-04 | 이미 `RESTORED` | 409 `RESTORE_NOT_APPLICABLE`(확정된 확보 없음) |

- 확보·재고 행은 비관적 락으로 잠그며, 교착 방지를 위해 메뉴 ID 순서로 잠근다.
- 만료 스케줄러는 `expires_at`이 지난 `RESERVED` 확보를 `EXPIRED`로 바꾸고 `reserved_qty`를 되돌린다. 처리 직전 상태를 다시 확인하므로 그 사이 확정된 확보는 건드리지 않는다.

## 테이블 (Flyway V1·V2)

| 테이블 | 내용 |
|---|---|
| `inventories` | 메뉴별 실제 재고(`stock_qty`)와 임시 확보 수량 합(`reserved_qty`). 주문 가능 수량 = `stock_qty - reserved_qty`. V2에서 논리 삭제 시각 `deleted_at` 추가(IN-06) |
| `inventory_reservations` | 임시 주문(`order_id`)당 확보 1건. 상태 `RESERVED → CONFIRMED / RELEASED / EXPIRED`, 확정 후 취소 시 `CONFIRMED → RESTORED` |
| `inventory_reservation_items` | 확보 건의 메뉴별 수량 |
| `inventory_histories` | 재고 변동 이력 (`RESERVE`, `CONFIRM`, `RELEASE`, `RESTORE`, `RESTOCK`, `ADJUST`) |

## 규칙

- DB 구조 변경은 Flyway 마이그레이션(`src/main/resources/db/migration`)으로만 한다. `ddl-auto`는 `none`.
- 응답은 공통 형식(`success`, `data`, `message`, 실패 시 `errorCode`).