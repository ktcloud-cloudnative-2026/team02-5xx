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
| OR-02 | POST | `/api/v1/orders/{orderId}/pay` | 모의 결제 요청 및 주문 확정 (결제 → 재고 확정 → PAID, 주문번호 발급, `OrderConfirmed` outbox 저장) |
| OR-03 | GET | `/api/v1/orders?page=0&size=20` | 본인 주문 목록 (CREATED·FAILED 제외, 최신순) |
| OR-04 | GET | `/api/v1/orders/{orderId}` | 본인 주문 상세 (타인 주문은 404) |

- 임시: 사용자 식별은 `X-User-Id` 헤더를 쓴다. 클라이언트가 임의로 보낼 수 있어 **다른 사용자의 ID를 알면 그 사용자의 주문을 조회할 수 있다.** 인증 방식이 확정되면 검증된 사용자 정보로 교체해야 한다.
  - **외부 노출 금지 조건**: 인증 교체 전에는 `/api/v1/orders` 경로를 Gateway·Ingress로 외부에 열지 않는다. 로컬·개발자 확인과 서비스 간 테스트에만 쓰고, order-service의 외부 Ingress·Gateway 라우트 추가 PR은 인증 교체 이슈가 끝나기 전에는 병합하지 않는다.
  - 교체 작업은 별도 이슈로 관리한다(Auth 담당과 JWT 전달 방식 합의 필요).
- 매장은 기본 영업 종료·주문 미접수 상태이며, 접수 상태를 바꾸는 관리자 API(OR-07)는 아직 없다. 로컬 확인 시 `store_operations`를 직접 갱신한다.
- Menu·Inventory 내부 API의 요청·응답 필드는 초안이다(`client` 패키지 참고). 담당자와 합의 후 확정한다.

### 결제(OR-02) 동작 규칙

- **주문 생성 단계에서 거르는 것**: 옵션 이름을 `, `로 이어붙인 길이가 255자를 넘는 항목이 있으면 `400 INVALID_REQUEST`로 거절한다. Cooking이 그 값을 255자 컬럼(`option_summary`)에 저장하므로, 결제 뒤에 Cooking 저장이 실패해 돈만 받고 조리가 안 되는 주문을 막기 위해서다.
- 같은 주문에 `pay`를 여러 번 호출해도 안전하다. 결제는 `idempotencyKey`(`order-{orderId}`)로, 주문 확정은 행 잠금과 상태 확인으로 중복을 막는다. 이미 확정된 주문은 현재 상태를 그대로 돌려준다.
- **같은 주문을 동시에 결제 처리하지 않는다.** 결제 처리를 시작할 때 `orders.pay_lock_until`을 조건부 UPDATE(주문이 `CREATED`이고 독점이 없거나 만료됐을 때만 성공)로 잡은 요청만 Menu·Payment·Inventory를 호출한다. 독점을 못 잡은 요청은 아무것도 호출하지 않고 현재 상태로 응답한다(확정됐으면 그 결과, 종료됐으면 `ORDER_NOT_PAYABLE`, 처리 중이면 `409 ORDER_PAY_IN_PROGRESS`). 독점을 잡은 뒤 주문 상태를 다시 읽고, 결제 요청 시각 기록도 `CREATED`일 때만 성공하므로 오래된 상태로 결제·환불하지 않는다. 독점은 60초 뒤 자동으로 풀려 서버가 중간에 죽어도 재시도가 이어받는다. 독점을 잡을 때마다 `orders.pay_lock_token`(UUID)이 새로 발급되고, **해제·연장·상태 변경(요청 시각·결제 ID 기록, 확정, 종료)은 토큰이 일치할 때만** 한다. 그래서 독점이 만료돼 다른 요청이 이어받은 뒤에 이전 요청이 늦게 끝나도 새 소유자의 독점을 풀거나 주문을 바꾸지 못한다. 결제·환불·재고 확정 같은 외부 호출 직전에는 독점을 연장하면서 아직 내 것인지 확인하고, 잃었으면 아무것도 하지 않고 `409 ORDER_PAY_IN_PROGRESS`로 멈춘다(이어받은 요청이 같은 멱등키로 결과를 이어서 처리한다).
- 결제 실패 확정 → 주문 `FAILED`, 재고 해제, 재시도는 새 주문. 결제를 한 번도 요청하지 않았는데 재고 확보가 만료되었으면 결제 없이 `HOLD_EXPIRED`로 종료한다.
- 결제 성공 후 재고 확정이 거부되면 결제를 취소하고 `FAILED`(`STOCK_CONFIRM_FAILED`)로 종료한다. 취소까지 실패하면 `fail_reason`이 `STOCK_CONFIRM_FAILED_REFUND_NEEDED`로 남아 수동 확인 대상이 된다.
- 결제·재고 확정 결과를 알 수 없으면(타임아웃, 5xx) 성공·실패를 정하지 않고 주문을 `CREATED`로 두고 503을 돌려준다. 같은 주문으로 다시 호출하면 이어서 처리된다.
- **결제가 이미 됐을 수 있는 주문**: 결제를 요청하기 직전에 `orders.payment_requested_at`을 기록하고(기록에 실패하면 결제를 요청하지 않는다), 결제가 성공하면 곧바로 `payment_id`를 저장한다. 기록이 있는 주문은 재시도할 때 재고 확보가 만료됐거나 그 사이 메뉴 판매가 중지됐어도 **결과를 확인하기 전에 종료하지 않는다.** 같은 `idempotencyKey`로 PI-01을 다시 호출해 처음 결과를 받는다(PI-02 대신).
  - 결제 성공 → 재고 확정 시도. 확정되면 `PAID`, 거절되면(확보 만료 포함) 환불 후 `FAILED`(`STOCK_CONFIRM_FAILED`).
  - 결제 실패 확정 → `FAILED`(`PAYMENT_FAILED`). 결과를 계속 알 수 없으면 `CREATED`로 두고 503.
  - 같은 키로 다시 호출했는데 이미 환불된 결제(`REFUNDED`)가 오면 돈은 돌아간 상태이므로 다시 환불하지 않고 `FAILED`(`PAYMENT_REFUNDED`)로 종료한다. (환불까지 끝났는데 주문 종료 저장만 실패했던 경우)
  - 메뉴 판매 중지로 재시도가 막히면 결제 결과를 확인해 성공이면 환불하고 `FAILED`(`MENU_NOT_AVAILABLE`)로 종료한다. 환불까지 실패하면 `fail_reason`이 `*_REFUND_NEEDED`로 남아 수동 확인 대상이 된다.
  - 결제 요청이 Payment에 닿지 않았던 경우에도 같은 키로 재호출하면 새로 결제될 수 있지만, 이어지는 확정 단계에서 거절되면 바로 환불한다.
- Inventory 응답 해석(Inventory 담당과 2026-11-16 합의): II-01 `409`(`INSUFFICIENT_STOCK`, `STOCK_NOT_LINKED`)은 재고 부족, II-02 `409`(`HOLD_NOT_ACTIVE`: 만료·해제된 확보)와 `404`(`HOLD_NOT_FOUND`)는 확정 불가(결제 취소 후 주문 종료), 이미 확정된 건의 재호출은 `200`. 그 밖의 `4xx`(요청·인증 오류)는 재고 판단으로 단정하지 않고 `502`로 응답하며 주문을 그대로 둔다. `5xx`·연결 실패는 결과 불명이다.
- 주문번호는 `yyMMdd-0001` 형식(날짜별 일련번호)이며 확정 트랜잭션에서 발급한다.
- 조리 시간은 Order DB에 저장하지 않는다. 결제를 시작할 때 Menu(MI-01)에서 다시 받아 `OrderConfirmed`(`cookTimeSec`, 옵션 `extraCookTimeSec`)에 싣는다. Menu에 연결할 수 없으면 결제 전에 503으로 끝나 돈이 나가지 않고, 그 사이 판매가 중지된 메뉴가 있으면 주문을 종료(`MENU_NOT_AVAILABLE`)하고 재고를 반환한다.
- `OrderConfirmed`는 `outbox_events`에 `PENDING`으로 저장만 한다. 실제 발행은 후속 작업(RabbitMQ 발행기)에서 구현한다.

## 주문 취소 (OR-05)

`POST /api/v1/orders/{orderId}/cancel` (본인 주문만, 다른 사용자의 주문은 404, 부분 취소 없음). 취소 가능 여부는 Cooking이 최종 판단한다(CI-03).

| 주문 상태 | 처리 |
|---|---|
| `CREATED`(결제 전) | 재고 확보만 해제(II-03)하고 `CANCELED`. 환불·Cooking 호출 없음. 이미 만료·해제된 확보도 성공으로 본다 |
| `CREATED`인데 결제를 요청한 적이 있음 | 결제가 됐을 수 있어 취소하지 않고 `409 ORDER_PAYMENT_PENDING`. 결제를 다시 호출해 결과를 확인한 뒤 처리한다 |
| `PAID` 이후(조리 전) | Cooking에 취소 요청(CI-03). 받아들이면 `CANCELED`로 바꾸고 재고 복원(II-04)과 환불(PI-03) |
| `COMPLETED`, `FAILED` | `409 ORDER_NOT_CANCELABLE` |
| 이미 `CANCELED` | 현재 상태를 그대로 돌려준다(멱등). 남은 후속 처리가 있으면 이어서 한다 |

- **응답을 모른 채 끝난 취소 요청**: Cooking을 호출하기 직전에 `orders.cancel_requested_at`을 기록한다. 타임아웃·5xx로 결과를 모르면(`503 COOKING_SERVICE_UNAVAILABLE`) 이 기록이 남고, 고객이 다시 호출하지 않아도 `CancelFollowUpScheduler`가 CI-03을 다시 호출해 확정한다(Cooking 취소는 멱등). Cooking이 취소를 받아들이면 `CANCELED`와 후속 처리로 이어지고, 조리 시작·완료·접수 전으로 거절하면 기록을 지워 더 이상 확인하지 않는다. 계약과 다른 응답(502)도 재확인해도 소용없으므로 기록을 지우고 에러 로그를 남긴다. (Cooking은 취소를 커밋했는데 Order가 응답을 못 받으면 "결제는 됐는데 조리도 환불도 안 되는 주문"이 생길 수 있어서 둔 장치다 — #61 리뷰.)
- **Cooking 응답 해석(CI-03)**: 200만 취소 확정. `409 COOKING_ALREADY_STARTED`·`409 COOKING_ALREADY_DONE`은 각각 같은 코드로 응답하고 주문은 그대로 둔다. `404 COOKING_TICKET_NOT_FOUND`는 "접수 처리 중"일 수 있어 취소로 보지 않고 `409 COOKING_ORDER_PENDING`으로 안내한다(errorCode가 다른 404는 계약 위반으로 502). 5xx·타임아웃은 결과를 알 수 없어 주문을 그대로 두고 `503 COOKING_SERVICE_UNAVAILABLE`로 응답하며, 재호출하거나 위 재확인으로 이어진다. Cooking 취소는 멱등이라 우리 쪽 저장이 실패해도 재호출로 이어진다.
- **후속 처리 실패**: 재고 복원이나 환불이 실패해도 주문은 `CANCELED`로 두고 응답도 200이다. 끝난 단계는 `orders.stock_restored_at`·`refunded_at`에 기록하고, 안 끝난 단계는 둘 중 하나가 NULL로 남아 재시도 대상이 된다(확정된 주문, 곧 `order_no`가 있는 취소 주문만 해당). 두 단계는 서로 독립이라 한쪽이 실패해도 다른 쪽은 진행한다.
- **환불 응답 해석(PI-03, Payment 정진혁 확인)**: `200`이면서 본문이 `status: REFUNDED`·같은 `paymentId`일 때만 환불됨으로 본다(이미 환불된 결제도 같은 `200`이라 재호출이 안전하다). `409 PAYMENT_NOT_REFUNDABLE`(승인되지 않은 결제)과 그 밖의 4xx(없는 결제 등)·계약과 다른 응답은 다시 호출해도 결과가 같아 성공으로 기록하지 않고 **에러 로그(수동 확인)**를 남긴다. `5xx`·타임아웃만 재시도 대상이다. 결제 후 재고 확정 거절로 환불할 때도 같은 해석을 쓴다.
- **재시도**: 같은 주문의 취소를 다시 호출하거나, `CancelFollowUpScheduler`가 30초마다(`cancel.follow-up.interval-ms`) 남은 단계를 이어서 처리한다. 재고 복원은 `409 RESTORE_NOT_APPLICABLE`이면 성공으로 기록하지 않고 에러 로그를 남겨 수동 확인에 맡긴다(스케줄러가 계속 다시 시도하며 로그가 반복된다).
- **재시도 상한·수동 확인(이슈 #125)**: 후속 처리가 실패하면 `orders.cancel_follow_up_attempts`(실패 횟수)를 늘리고 `cancel_follow_up_next_attempt_at`(다음 시도 시각)을 정해, 실패할수록 간격을 두 배로 늘려(기본 30초 → 최대 1시간) 다시 시도한다. 실패가 **12번**(`cancel.follow-up.max-attempts`, 간격 합 약 5시간 반)에 닿으면 `cancel_follow_up_manual_at`·`cancel_follow_up_manual_reason`(`RETRY_LIMIT_EXCEEDED`)으로 **수동 확인 필요**를 표시하고 스케줄러 대상에서 뺀다. 남은 단계가 전부 **다시 호출해도 결과가 같은 실패**(환불 불가 409·복원 불가 409·계약과 다른 응답)이면 상한을 기다리지 않고 바로 수동 확인 필요로 표시한다(`REFUND_NOT_REFUNDABLE`, `RESTORE_NOT_APPLICABLE`, `REFUND_INVALID_RESPONSE`, `RESTORE_INVALID_RESPONSE`). 한 단계가 영구 실패여도 다른 단계(예: 환불)가 재시도로 풀릴 수 있으면 자동 재시도를 계속한다. 설정: `cancel.follow-up.max-attempts`·`retry-base-sec`·`retry-max-sec`.
- **알림**: 수동 확인이 필요해지는 순간 에러 로그 한 줄(`수동 확인 필요: 취소 후속 처리를 더 이상 자동 재시도하지 않습니다 orderId=… paymentId=… reason=…`)을 남기고, 지표 `order_cancel_follow_up_manual_required`(수동 확인이 필요한 미완료 취소 주문 수)를 `/actuator/prometheus`로 노출한다. 0보다 크면 확인이 필요하다. 알림 규칙(Grafana 등)은 모니터링 담당과 정한다.
- **수동 확인 운영 방법**: 목록은 `select id, order_no, payment_id, stock_restored_at, refunded_at, cancel_follow_up_manual_reason from orders where status = 'CANCELED' and cancel_follow_up_manual_at is not null and (stock_restored_at is null or refunded_at is null);`. 원인을 해결한 뒤 같은 주문의 취소를 다시 호출하면 남은 단계를 이어서 처리하고(성공하면 지표에서 빠진다), 자동 재시도를 다시 켜려면 `cancel_follow_up_manual_at`·`cancel_follow_up_manual_reason`·`cancel_follow_up_next_attempt_at`을 NULL로, `cancel_follow_up_attempts`를 0으로 되돌린다. Payment나 Inventory에서 직접 처리했다면 `refunded_at`·`stock_restored_at`을 기록해 완료로 표시한다.
- **범위 밖**: Cooking 응답을 모른 채 남은 취소 요청(`cancel_requested_at`) 재확인에는 아직 상한이 없다(주문은 `PAID`로 유지되어 조리는 계속되므로 돈·재고 손실은 없다). 필요하면 별도 이슈로 다룬다.
- **동시성**: 결제와 같은 처리 독점(`pay_lock_*`, 소유권 토큰)을 잡고 진행한다. 결제 중이거나 다른 취소가 처리 중이면 `409 ORDER_PAY_IN_PROGRESS`. 외부 호출 직전마다 독점을 연장하며 확인하고, 잃었으면 아무것도 하지 않고 멈춘다.
- **Inventory 확인 완료(남규리, Inventory PR #115 대조)**: II-04는 성공 시 `200 {orderId, restored: true}`이고 이미 복원된 주문도 같은 `200`(중복 복원 없음), 확정되지 않았거나 예약이 없으면 `409 RESTORE_NOT_APPLICABLE`, 요청 형식 오류는 `400`뿐이다. II-03은 해제·이미 해제·만료 `200`, 확정된 확보 `409 HOLD_NOT_ACTIVE`, 없는 확보 `404 HOLD_NOT_FOUND`. 이 PR의 해석(200만 성공, 409는 복원 불가·이미 확정, 그 밖의 4xx는 502, 5xx는 재시도 대상)과 일치한다.

## Cooking 장애 시 신규 주문·결제 차단 (US-13)

Cooking 담당(김지윤)과 합의한 방식이다.

- Order가 Cooking의 `GET /actuator/health`(인증 없음)를 5초 주기로 확인한다. 응답 타임아웃은 2초(연결 타임아웃 1초를 더해 한 번 확인에 최악 약 3초)이고, HTTP 503(DOWN)·그 외 오류 응답·연결 실패·타임아웃은 모두 실패로 센다.
- **3회 연속 실패**하면 "Cooking 장애"로 판단하고, **한 번이라도 성공하면 바로 해제**한다. 기동 직후에는 정상으로 간주한다(첫 실패 한 번으로 차단하지 않음). 상태는 인스턴스마다 독립적으로 판단한다.
- 장애 상태에서는 **신규 주문 생성(OR-01)과 결제(OR-02)**만 `503 COOKING_UNAVAILABLE`로 거절한다. 매장 접수 설정(`store_operations`)과는 별개이며, 접수가 닫혀 있으면 `STORE_NOT_ACCEPTING_ORDERS`(409)가 먼저 나온다.
- 영향을 받지 않는 것: 주문 목록·상세 조회, 이미 확정된 주문(결제 재호출 시 현재 상태 반환), **결제를 이미 요청한 적이 있는 주문**(같은 키로 기존 결과를 확인하는 것이라 새 결제가 아니므로, 결제가 됐을 수 있는데 사용자가 "결제 불가"만 보지 않도록 결과 확인·복구를 이어서 한다), `CookingCompleted` 수신, outbox 발행. 장애로 결제가 거절된 주문은 `CREATED`로 남고 재고 확보 만료 규칙은 그대로 적용된다(만료되면 종료).
- 스케줄러 스레드: Spring 기본은 1개라서 outbox 발행이 RabbitMQ 확인을 기다리는 동안(최대 5초) 헬스 점검이 함께 멈출 수 있다. `SchedulingConfig`에서 `@Scheduled` 작업 수(outbox 발행, Cooking 헬스 점검)만큼 스레드를 두어 서로 막지 않게 했고, 회귀 테스트(`SchedulerIsolationTest`)가 이를 확인한다. `@Scheduled` 작업을 추가하면 `POOL_SIZE`도 늘린다.
- 관측: 상태 전환은 로그로 남고, 지표 `order_cooking_available`(1=정상, 0=차단 중)을 `/actuator/prometheus`로 노출한다.

## 이벤트 (RabbitMQ)

Cooking 담당(김지윤)과 2026-11-16에 아래 내용으로 합의했다. 모든 큐는 durable이고 메시지는 persistent로 발행한다.

| 구분 | 이름 |
|---|---|
| 교환기(topic, durable, autoDelete=false) | `peakorder.events` — Order와 Cooking이 같은 속성으로 선언 |
| OrderConfirmed 라우팅 키 | `order.confirmed` (Order → Cooking) |
| CookingCompleted 라우팅 키 | `cooking.completed` (Cooking → Order) |
| Cooking이 받는 큐 | `cooking.order-confirmed` + DLQ `cooking.order-confirmed.dlq` (**Cooking이 선언**, `order.confirmed`로 바인딩) |
| Order가 받는 큐 | `order.cooking-completed` + DLQ `order.cooking-completed.dlq` (Order가 선언) |
| 보관용 교환기 | `peakorder.dlx` (direct, durable, autoDelete=false). 양쪽 DLQ가 같은 교환기를 쓴다. 큐는 `x-dead-letter-exchange=peakorder.dlx`, `x-dead-letter-routing-key=<큐 이름>`으로 선언하고 DLQ(`<큐 이름>.dlq`)를 큐 이름 키로 바인딩한다 (Cooking과 확인 완료) |

- **발행(OrderConfirmed)**: 주문 확정 트랜잭션이 `outbox_events`에 `PENDING`으로 저장한 이벤트를 1초 주기로 발행하고 `SENT`로 바꾼다. 브로커 확인(publisher confirm)을 받은 뒤에만 `SENT`로 바꾸며, 큐에 바인딩되지 않아 되돌아온(unroutable) 메시지도 실패로 보고 `PENDING`으로 남겨 다시 발행한다. 최소 한 번 전달이므로 받는 쪽이 `eventId`로 중복을 걸러야 한다.
- **수신(CookingCompleted)**: `processed_events`에 `eventId`를 저장하고 주문을 `COMPLETED`로 바꾸는 것을 한 트랜잭션에서 하며, 처리가 끝난 뒤에만 ack 한다. 이미 처리한 `eventId`는 무시한다.
- **재시도·DLQ**: 일시적일 수 있는 오류(DB 연결 문제 등)는 최대 3회 시도(첫 시도 포함, 1초·2초 간격) 후 DLQ에 보관한다. 다시 시도해도 소용없는 오류(JSON 형식 오류, 필수값 누락, 존재하지 않는 주문, 취소·미확정 주문에 대한 완료 이벤트)는 재시도 없이 바로 DLQ에 보관한다. Cooking의 수신 정책도 같다.
- **DLQ 알림**: Cooking(모니터링 담당)이 Grafana에서 "DLQ 메시지 수 > 0이 1분 지속" 알림을 구성한다(모니터링 인프라 준비 후).
- **메시지 본문**(JSON, camelCase, `messageId`=`eventId`)
  - `OrderConfirmed`: `eventId`, `orderId`, `orderNo`, `userId`, `confirmedAt`, `items[]`(`menuId`, `menuName`, `quantity`, `cookTimeSec`, `options[]`(`optionId`, `optionName`, `extraCookTimeSec`))
  - `CookingCompleted`: `eventId`(UUID), `orderId`, `completedAt`(ISO 8601, +09:00)
- **Cooking 쪽 처리 규칙(합의)**: `cook_time_sec = cookTimeSec + 옵션 extraCookTimeSec 합`(1개 기준), `option_summary`는 `optionName`을 ", "로 이어붙임(옵션 없으면 NULL), `estimated_cook_sec = Σ(cook_time_sec × quantity)`, `queued_at`은 Cooking DB 등록 시각(FIFO). 같은 `eventId`는 무시, `eventId`가 달라도 같은 `orderId`의 전표가 있으면 경고 로그 후 무시한다. 취소된 전표에는 `CookingCompleted`를 보내지 않는다(Cooking은 `WAITING`에서만 취소, `COOKING`에서만 완료 가능).
- **후속(US-13) 합의 사항**: Cooking 장애 감지는 Order가 Cooking의 `GET /actuator/health`(인증 없음)를 확인해 2초 타임아웃·3회 연속 실패(또는 HTTP 503)이면 신규 주문·결제를 차단하고, 성공하면 자동 해제한다. 아직 구현 전이다. CI-02는 전표가 없으면 404 `COOKING_TICKET_NOT_FOUND`를 돌려주며 이는 "접수 처리 중"으로 해석한다.

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
| `PAYMENT_SERVICE_URL` | Payment Service 내부 주소 | `http://localhost:8083` |
| `COOKING_SERVICE_URL` | Cooking Service 내부 주소(헬스 확인용) | `http://localhost:8084` |
| `COOKING_HEALTH_INTERVAL_MS` / `COOKING_HEALTH_FAILURE_THRESHOLD` | Cooking 헬스 확인 주기(ms) / 장애로 판단할 연속 실패 횟수 | `5000` / `3` |

## 규칙

- DB 구조 변경은 Flyway 마이그레이션(`src/main/resources/db/migration`)으로만 한다. `ddl-auto`는 `none`.
- 응답은 공통 형식(`success`, `data`, `message`, 실패 시 `errorCode`).
