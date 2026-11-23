# Peak Order — 기획 대비 개발 변경사항 정리

> **작성·현황 확인 기준일:** 2026-11-23 (KST)  
> **계속 관리:** [Issue #193 — 기획 대비 개발 변경사항](https://github.com/ktcloud-cloudnative-2026/team02-5xx/issues/193)  
> **비교 기준:** 2026-11-13 전후 확정된 Notion 요구사항·API·ERD·설계 결정 및 저장소 `docs/api/notion-draft.md`, `docs/erd/notion-draft.md`  
> **구현·병합 상태 확인 기준:** GitHub `main` [`0c65ed0`](https://github.com/ktcloud-cloudnative-2026/team02-5xx/tree/0c65ed0369acb9da0dc1e4cef7d7cff8223c4a59) 및 2026-11-23에 확인한 개별 PR 상태  
> **최초 조사 기준(과거 스냅샷):** `main` [`ca43852`](https://github.com/ktcloud-cloudnative-2026/team02-5xx/tree/ca43852c7f2a87eeebfa7b09896ec4f0a8f84e25). 이후 #143·#148·#183·#185·#190·#210·#220의 병합 상태는 아래에 갱신했다.  
> **목적:** 초기 설계와 실제 개발 계약의 차이, 변경 이유, 문서 반영 필요 항목을 기록한다. **구현 여부와 실제 dev/prod 배포·통합 검증 여부는 별개**다.

## 0. 판정 기준 및 범위

| 표기 | 뜻 |
| --- | --- |
| **main 반영** | 위에 명시된 최신 확인 커밋의 `main`에 해당 코드·문서·매니페스트가 존재함 |
| **PR 진행** | 2026-11-23 확인 시 별도 PR이 열려 있으며, 최신 확인 시점 `main`에 포함되지 않음 |
| **설계와 구현 차이** | 현재 코드와 기획·설정의 불일치 또는 미반영 상태. 팀 합의에 따른 최종 변경은 아닐 수 있음 |
| **실환경 미확인** | 코드·테스트/문서만 확인했으며 dev/prod 종단 간 동작을 단정할 수 없음 |

**주의: 기획 단계의 변경을 개발 단계 변경으로 중복 계산하지 않는다.** 2026-11-09에 백엔드 3개 중심 구상에서 Auth·Menu·Order·Inventory·Payment·Cooking **6개 MSA + React 프론트엔드**로 재설계하고, 혼잡도를 Cooking에 통합하고, 서비스별 독립 DB·모의 결제·재고 분리를 확정한 것은 *개발 전 기획 변경*이다. 11/13 기준으로 이미 결정된 사항이며 이후 코드를 구현했다고 해서 새로 바뀐 설계로 기록하지 않는다. 참고: [설계 결정 기록](https://app.notion.com/p/40f2f07e947880e79b0bd511e54367a5), [아키텍처](https://app.notion.com/p/40f2f07e9478800e9985d80e19ebe7d2).

## 1. API 및 서비스 계약 변경·구체화

### 1-1. Auth — JWT 세션의 구체적인 전달·보안 계약 (main 반영)

- **기획:** AU-01 로그인/JWT 발급, AU-02 내 정보, AU-09 재발급, AU-10 로그아웃. 토큰 저장·회전·검증키·HTTP 응답 세부는 추가 설계 대상.
- **구현 상세:** Access Token은 **RS256 JWT(15분)**, Refresh Token 원문은 **쿠키로 전달**하고 DB에는 **SHA-256 해시**만 저장한다. Refresh는 세션 단위 회전·폐기, 기억하기(`rememberMe`)에 따른 만료(기본 1일/기억하기 14일)를 사용한다. `GET /api/v1/auth/jwks` 공개 검증키 조회가 추가됐다. `GET /api/v1/auth/me`는 Bearer Access Token을 요구하며, `POST /api/v1/auth/logout`은 공통 JSON이 아닌 **204 No Content + 쿠키 삭제**를 반환한다.
- **이유:** 브라우저에서 재발급 토큰을 직접 노출하지 않고, 중복 사용·세션 경쟁·서명 검증을 명확히 처리하기 위해서다.
- **주의:** `auth.session.enabled` 기본값은 `false`. 기능이 `main`에 있어도 Gateway JWT 인가·실제 HTTPS 쿠키·dev 활성화까지 완료됐다는 뜻이 아니다. AU-05·06(회원정보·비밀번호 변경)은 [PR #221](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/221)에서 개발돼 미병합이고, AU-07·08(복구)은 구현·병합 여부를 별도 확인해야 한다.
- **근거:** [PR #164](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/164), [SessionController](https://github.com/ktcloud-cloudnative-2026/team02-5xx/blob/main/services/auth-service/src/main/java/com/peakorder/auth/controller/SessionController.java), [Auth 구현 메모](https://github.com/ktcloud-cloudnative-2026/team02-5xx/blob/main/docs/api/auth-session-implementation-plan.md).

### 1-2. Menu — 고객 조회·구매 검증의 상세 계약 (main 반영)

- **ME-01 `GET /api/v1/menus`:** 기획의 '판매 메뉴 목록'을 구체화해 `categoryId`, `query`, `sort=default|priceAsc|priceDesc`를 지원한다. **ON_SALE·PAUSED는 조회하고 HIDDEN은 제외**한다. 카테고리를 함께 반환하며 필터·정렬·동률 처리 및 빈 목록·잘못된 쿼리 오류를 명시했다. 현재 구현은 페이지네이션하지 않는다.
- **ME-02 `GET /api/v1/menus/{menuId}`:** PAUSED는 상세 **조회 가능**하나 주문 가능하다는 뜻은 아니다. HIDDEN/없는 메뉴는 404, 옵션의 `isDefault`·`active`, null 값의 응답 규칙을 상세화했다.
- **MI-01 `POST /internal/v1/menus/validate-purchase`:** 주문·조리 시간 계산에 필요한 `unitPrice`, `cookTimeSec`, 옵션별 `extraPrice`, `extraCookTimeSec`, `optionName`을 요청 순서대로 내려주도록 계약을 구체화했다. 실제 주문 금액·조리 시간 계산은 프론트엔드 값을 신뢰하지 않는다.
- **MI-02 `GET /internal/v1/menus/{menuId}/existence`:** Inventory 메뉴 연결 시 **존재·판매 상태를 확인**하는 내부 API로 확정했다.
- **기획과의 관계:** API 번호나 외부 URL 자체를 새로 만든 것이 아니라 **검색·상태·응답·오류 정책을 구현하면서 확정한 상세 계약**이다. 품절/가용 수량 판단은 여전히 Inventory 책임이다.
- **근거:** [ME-01/02 구현 계약](https://github.com/ktcloud-cloudnative-2026/team02-5xx/blob/main/docs/api/menu-me01-me02.md), [MI-01](https://github.com/ktcloud-cloudnative-2026/team02-5xx/blob/main/docs/api/menu-mi01.md), [MI-02](https://github.com/ktcloud-cloudnative-2026/team02-5xx/blob/main/docs/api/menu-mi02.md), [PR #105](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/105).

### 1-3. Order — 주문 생성·결제·취소·관리자 조회 구체화 (main 반영)

| API | 기획 대비 구현 확정/추가 내용 | 근거 |
| --- | --- | --- |
| OR-01 임시 주문 | 항목 1~20개·수량 1~99, 선택 옵션 검증. 가격은 Menu 검증값으로 계산. 먼저 `CREATED` 임시 주문을 만들고 Inventory 확보 정보를 기록. Cooking 장애 시 신규 주문 차단. | [#29](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/29), [#56](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/56) |
| OR-02 결제/확정 | 같은 주문의 중복 결제 방지를 위해 `idempotencyKey=order-{orderId}`, 처리 독점 잠금·불명 결과 재확인 규칙 도입. **결제·재고 확정 뒤** 날짜별 `orderNo` 발급. 응답을 못 받았다는 이유만으로 주문을 실패 처리하지 않음. | [#46](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/46) |
| OR-03 본인 주문 목록 | `CREATED`·`FAILED` 임시 주문은 고객 목록에서 제외. `page`·`size` 페이징과 대표 메뉴/항목 수 추가. | [#29](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/29) |
| OR-04 주문 상세 | 기존 주문 스냅샷 외에 Cooking **CI-02를 조회해 `cooking` 객체로 현재 조리 상태·예상 시간을 제공**. 응답 장애는 주문 상세 전체 실패 대신 `lookup=UNAVAILABLE`로 격리하고 200 상세 응답을 유지. | [#142](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/142), [#154](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/154) |
| OR-05 취소 | Cooking의 최종 취소 판정 이후 주문을 `CANCELED`로 처리하고, 재고 복원(II-04)·환불(PI-03)을 **별도 후속 처리/재시도**. 실패 시 취소 자체를 되돌리지 않고 남은 작업과 수동 확인 필요 상태를 추적. | [#61](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/61), [#135](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/135) |
| OR-06·07 영업/접수 | `store_operations` 단일 행(id=1), 초기 영업 종료·접수 중지. PATCH는 전달된 필드만 변경하고 불린 타입을 엄격 검증. | [#133](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/133) |
| OR-08·09 관리자 주문 | 기획의 URL을 구현하면서 기간·주문번호·상태·`manualReviewRequired` 검색, 최근 31일 기본 기간, 페이징, 상세 환불·복원·수동 확인 필드를 확정. **2026-11-20 `main` 병합**. | [#170](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/170) |

**관리자 노출 정책 변경(임시 안전장치):** 기획은 `STORE_ADMIN` 인가를 가정하지만, 실제 Order `OR-06~09`는 인증/Gateway 계약 최종 적용 전 `ORDER_ADMIN_ENABLED=false`가 기본이고 API 매핑 자체가 비활성화된다. 활성화해도 자체 권한 검사가 완성됐다는 의미가 아니므로 **공유 dev/prod에서 임의로 켜면 안 된다**. Cooking 관리자 조회도 `COOKING_ADMIN_ENABLED`로 비슷하게 차단한다. 이는 기능 삭제가 아니라 보안 미완료 기간의 임시 노출 정책이다. [Order Controller](https://github.com/ktcloud-cloudnative-2026/team02-5xx/blob/main/services/order-service/src/main/java/com/peakorder/order/controller/AdminOrderController.java), [#170](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/170).

### 1-4. Cooking — 예상 시간 의미 변경 (main 반영, 중요 계약 변경)

**실제 변경:** CI-02 `GET /internal/v1/cooking/orders/{orderId}`의 기존 `expectedWaitSec`가 **조리 완료까지 남은 시간**으로 사용되던 문제를 바로잡아, CO-01·CO-02와 동일하게 **조리 시작까지 남은 시간**으로 통일하고 `expectedReadySec`(조리 완료까지)를 새로 추가했다.

| 상태 | `expectedWaitSec` (조리 시작까지) | `expectedReadySec` (조리 완료까지) |
| --- | --- | --- |
| WAITING | 현재 조리 잔여 + 내 앞 대기 주문 예상 조리시간 | `expectedWaitSec + estimatedCookSec` |
| COOKING | `0` | 내 주문의 남은 조리시간 |
| DONE / CANCELED | `0` | `0` |

- 기존 `estimatedCookSec`는 **내 주문 예상 조리 총시간**이다. CO-02의 `cookSec`는 **주문 전 선택 항목**의 조리시간으로 구분된다.
- Order는 이후 **기존 CI-02 응답 호환 변환을 제거**했다. 이제 `expectedReadySec` 누락·음수는 업스트림 계약 위반이며 주문 상세의 `cooking.lookup=UNAVAILABLE`로 격리한다.
- CO-02는 Menu MI-01로 서버에서 조리 시간을 검증하며, 메뉴 판매 불가 4xx는 고객이 이해할 수 있도록 **409 `MENU_NOT_AVAILABLE`**로 변환한다.
- **근거:** [#141](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/141), [#154](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/154), [CO-02 명세](https://github.com/ktcloud-cloudnative-2026/team02-5xx/blob/main/docs/api/cooking-co02.md).

### 1-5. Inventory / Payment — 내부 연동 오류와 멱등 계약 구체화 (main 반영)

- **Inventory II-01~04:** 재고 확보 → 확정 → 해제 → 취소 후 복원의 경계가 구체화됐다. `POST /internal/v1/inventory/restorations`에 `{ "orderId": ... }`를 보내며, 이미 복원했으면 성공(멱등), 복원할 수 없으면 `409 RESTORE_NOT_APPLICABLE`이다. 보류 확보 만료는 DB 스케줄러가 관리한다. Order는 재고 관련 409를 업무 오류(품절·확정 실패 등)로 매핑한다. [#115](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/115), [API 초안 보완](https://github.com/ktcloud-cloudnative-2026/team02-5xx/blob/main/docs/api/notion-draft.md).
- **Payment PI-01~03:** `idempotencyKey` 중복 결제 방지, 결제 결과 불명 시 임시 주문을 유지하고 **동일 키로 재시도**하는 원칙(현재 Order는 PI-02 조회 API를 직접 사용하지 않음), 환불 `200` 응답의 `status=REFUNDED` 검증·중복 환불 안전성 등을 구체화했다. 서비스의 DB 내부 상태(`APPROVED` 등)와 내부 HTTP 응답 상태(`SUCCESS` 등)는 구분한다. [#71](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/71), [Payment Controller](https://github.com/ktcloud-cloudnative-2026/team02-5xx/blob/main/services/payment-service/src/main/java/com/peakorder/payment/controller/InternalPaymentController.java).
- **검증 범위 주의:** 각 내부 API의 존재와 계약·일부 로컬 연동 테스트는 확인됐으나 전체 주문→재고→결제→조리의 dev 종단 간 시나리오 통과를 이 문서가 보증하지 않는다.

## 2. DB / ERD — 실제 Flyway 기준

### 2-1. 데이터 저장소 공통

- 서비스별 DB 소유권, **dev 6개 + prod 6개**, PostgreSQL VM, 테이블명 복수형 `snake_case`, Flyway 관리, **서로 다른 서비스 ID는 FK를 맺지 않음**은 기존 확정 설계다. 개발 중 새로 바뀐 것으로 표시하지 않는다.
- 아래는 *새 테이블이 기획에서 아예 없었다는 뜻이 아니라*, **코드를 작성하면서 확정·추가된 컬럼, 제약, 인덱스, 정확한 저장 정책**을 기록한 것이다.

### 2-2. 서비스별 변경·확정 사항

| 서비스 / Flyway | 실제 구현에서 구체화·추가한 스키마·제약 | 변경 이유 / 기획 대비 확인 포인트 |
| --- | --- | --- |
| **Auth V1** | `users`(email UNIQUE, `CUSTOMER`/`STORE_ADMIN`, 상태), `user_agreements`(사용자·약관 종류·버전 UNIQUE) | 초안의 회원·동의 요구사항을 실제 제약으로 확정. **V1은 초기 설계의 구현**. |
| **Auth V2** | `refresh_tokens`: `user_id`, `session_id UUID`, `token_hash` UNIQUE, `expires_at`, `revoked`, `remember_me`; 활성 세션 유일 부분 인덱스 | 재발급 토큰 **해시 보관·회전·세션 폐기** 세부 구현을 위해 추가. [#164](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/164) |
| **Menu V1** | `categories`, `menus`, `menu_options`; `menus.status` 체크(`ON_SALE`, `PAUSED`, `HIDDEN`), `cook_time_sec`, 옵션 `extra_cook_time_sec`, `is_default`, `active`, 비음수 가격/시간 제약 | 메뉴 상태와 옵션·조리시간 계약을 DB로 명확히 고정. **별도 V2 변경은 기준 `main`에 없음**. [#76](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/76) |
| **Inventory V1** | `inventories.menu_id BIGINT UNIQUE NULL`, `stock_qty`, `reserved_qty`, `version`, `low_stock_threshold`; `inventory_reservations` / `_items` / `inventory_histories`; `reserved_qty <= stock_qty` 체크, `order_id` UNIQUE, 만료 검색 인덱스 | 재고를 메뉴와 독립 생성 후 1:1 연결, 동시 확보·만료·복원·이력 보관. **초기 확정 설계의 구체화이며 PR #143은 DB 변경 없음**. [#70](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/70) |
| **Order V1** | `orders`, `order_items`, `order_item_options`, `order_status_histories`, `store_operations`, `outbox_events`, `processed_events`. `orders.order_no`는 NULL 허용/UNIQUE. `store_operations` 단일 행 및 초기 `false/false`. | 임시 `CREATED` 주문에서 주문번호를 주지 않는 정책, 상태 이력·메시지 멱등 기록 고정. [#28](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/28) |
| **Order V2** | `orders.hold_id`, `hold_expires_at` | Inventory의 임시 확보 ID/만료 시각 보존. [#29](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/29) |
| **Order V3** | `payment_id`, `payment_requested_at`, `pay_lock_until`, `pay_lock_token`; `order_no_counters(order_date PK, last_seq)` | 결제 응답 유실·동시 결제 중복 처리, 날짜별 주문번호 발급을 위해 초기 ERD를 확장. [#46](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/46) |
| **Order V4** | `cancel_requested_at`, `stock_restored_at`, `refunded_at`와 취소 후속 작업 부분 인덱스 | Cooking 응답 불명 및 취소 뒤 환불·복원 실패를 **취소 상태와 분리해 재시도**. [#61](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/61) |
| **Order V5** | `cancel_follow_up_attempts`, `cancel_follow_up_next_attempt_at`, `cancel_follow_up_manual_at`, `cancel_follow_up_manual_reason`; 수동 확인 인덱스 | 무한 재시도 방지. 기본 상한 **12회** 이후 수동 확인 필요 표시·지표. [#135](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/135) |
| **Order V6** | `idx_orders_ordered_at (ordered_at DESC, id DESC)` | 새 OR-08 관리자 기간 검색·최신순 조회 최적화. 일반 `CREATE INDEX`이므로 대량 데이터 prod 적용 시 쓰기 대기 위험 검토. [#170](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/170) |
| **Payment V1** | `payments.order_id UNIQUE`, `idempotency_key UNIQUE`; `payment_refunds` 및 **완료 환불 1건만 허용**하는 부분 UNIQUE 인덱스 | 같은 주문의 중복 결제·중복 환불 방지. 초기 ERD 구현이며 별도 V2는 기준 `main`에 없음. [#71](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/71) |
| **Cooking V1** | `cooking_tickets`, `cooking_ticket_items`, `outbox_events`, `processed_events`, `congestion_thresholds`. `congestion_snapshots`는 선택 표로서 미생성. | Cooking 내 대기열·혼잡도 설정, 이벤트 처리 구조를 구현. [#42](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/42) |
| **Cooking V2** | `status='COOKING'` 행을 DB 전체에서 하나만 허용하는 **부분 UNIQUE 인덱스** | 스케줄러 동시 실행과 관계없이 단일 매장 **동시 조리 1건**을 DB에서 최종 보장. |
| **Cooking V3** | `cooking_tickets.queued_at DEFAULT clock_timestamp()` | 트랜잭션 시작 시각이 아니라 실제 INSERT 실행 시각으로 FIFO 등록 순서를 보정. [#109](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/109) |

실제 SQL: [`services/*/src/main/resources/db/migration`](https://github.com/ktcloud-cloudnative-2026/team02-5xx/tree/main/services) 아래 서비스별 마이그레이션. 과거 11/19 기준 [ERD 초안](https://github.com/ktcloud-cloudnative-2026/team02-5xx/blob/main/docs/erd/notion-draft.md)에 빠졌던 Order V6 및 OR-08·09 설명은 [문서 PR #183](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/183) 병합으로 현재 `main`에 반영됐다.

## 3. 비동기 이벤트 / 조리 처리 변경·구체화

| 항목 | 초기 확정 설계 → 개발 중 구체화 | 근거 |
| --- | --- | --- |
| 이벤트 종류 | 기존 결정인 **OrderConfirmed(Order→Cooking), CookingCompleted(Cooking→Order) 2개만** 사용. 메뉴/재고 변경 이벤트는 추가하지 않음. | [이벤트 계약](https://github.com/ktcloud-cloudnative-2026/team02-5xx/blob/main/docs/events/notion-draft.md) |
| 전송 안정성 | `peakorder.events`(topic)·DLX, 내구성 있는 큐, 발신 Outbox(`event_id UUID`, `payload JSONB`), 수신 `processed_events(event_id PK)`를 코드/테이블/큐 이름으로 고정. 기본 최소 한 번 전달에 대응. | [#52](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/52), [#57](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/57) |
| FIFO 정의 | `OrderConfirmed.confirmedAt`이 아니라 **Cooking DB에 전표가 실제 등록된 `queued_at`, `id` 순서**가 FIFO 기준이다. V3에서 timestamp 기본값 보정. | [#109](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/109) |
| 전표 복사 문자열 | OrderConfirmed의 `menuName`/옵션 요약을 Cooking 전표에 복사하되 컬럼 최대치(100/255자) 초과 시 **잘라 저장하고 경고**. 이미 결제된 주문이 표시 문자열 길이 때문에 DLQ로 빠지는 문제 방지. | [#113](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/113) |
| 취소/장애 | 조리 시작 전 취소의 최종 판정은 Cooking. Order는 불명 응답·환불·재고복원 실패를 별도 추적한다. 수신 오류는 재시도 후 DLQ로 보내고 멱등 처리. | [#61](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/61), [#135](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/135) |

**운영상 주의:** 큐·DLQ의 선언, 코드 단위/일부 로컬 검증과 **실제 dev RabbitMQ에서 Order→Cooking→Order 종단 간 성공**은 다르다. 후자는 별도 통합 테스트 결과로 판단한다.

## 4. 프론트엔드·인프라에서 설계와 달라진/추가된 점

| 구분 | 기획/정책 | 현재 코드·변경 사항 | 판정 |
| --- | --- | --- | --- |
| 장바구니 | 프론트 저장, 로그인 없이 담기 가능 | `localStorage` 키 `peak-order.cart.v1`, 버전 및 `{menuId, optionIds, quantity}` 저장. 결제/주문 시 로그인 모달 정책. [#116](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/116) | **main 반영**. 기획 변경이 아닌 저장 포맷 확정 |
| 실제 메뉴 HTTP 연동 | 고객 메뉴를 API로 표시 | ME-01/02 HTTP 연동 [#148](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/148)이 병합됐다. 로딩·재시도·오래된 응답 차단과 장바구니 데이터 보존 처리를 포함한다. | **main 반영**, 실제 dev 연동 검증은 별개 |
| 정적 이미지·기본 메뉴 이미지 | 미리 정한 기본 이미지와 정적 파일 제공 | [#220](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/220)에서 공통 메뉴 이미지 대체 경로, 기본 SVG 및 정적 이미지 경로를 구성했고 main에 병합됐다. | **main 반영**, 브라우저 이미지 실패 전환·실배포 Gateway HTTP 200은 별도 검증 |
| 로그인·Checkout HTTP 연동 | Auth 로그인 모달/JWT 세션, 결제·주문 API | Auth 세션 [#188](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/188) **Draft**를 포함해 Menu·Auth·Checkout을 통합한 [#233](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/233)이 리뷰 중이다. OR-01 생성 실패 복구 수정 요청이 남아 있다. 후속 고객 주문 내역·상세·취소 [#240](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/240)은 #233 브랜치를 Base로 하는 의존 PR이다. | **PR 진행**, 실제 dev 주문 E2E 미검증 |
| 관리자 메뉴 UI/API | 관리자 메뉴 CRUD | UI [#132](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/132), ME-03~07 [#117](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/117)·[#119](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/119)·[#123](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/123)·[#127](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/127) 모두 **Draft**, main 미포함. 판매 상태 변경 경로는 원래 `/sales-status`에서 수정 초안 `/status`로 제안됨 | **계약 제안/PR 진행**, 확정으로 기록 금지 |
| 재고 관리자/고객 조회 | IN-01~06 | IN-01·IN-03~05의 [#143](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/143)이 **main에 병합**됐다. #143 기준 IN-04는 **양방향 조정이 아닌 양수 입고만** 지원하며, IN-02·06은 이 PR의 범위 밖이다. 관리자 API 기본 비활성·과거 확정 예약 메뉴 재연결 제한 정책을 유지한다. | **main 반영(#143 범위)**, 전체 IN-01~06 및 실환경 검증은 별도 확인 |
| 인프라 네트워크 보안 | Gateway 단일 공개 진입·내부 서비스 경로 차단 | `peakorder`에 **기본 Ingress 차단 + 필요한 서비스별 Ingress만 허용**하는 NetworkPolicy 추가. Egress는 차단하지 않음. [#166](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/166) | **main 반영**, 실클러스터 적용/검증 별도 |
| RabbitMQ 환경 변수 | 공통 RabbitMQ 서비스/컨테이너 | K8s Service 환경변수가 앱의 `RABBITMQ_PORT`를 덮는 충돌 발견. Deployment의 `enableServiceLinks: false`로 변경. [#161](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/161) | **main 반영**, 구현 트러블슈팅 |
| dev Pod/HPA | 초기 설계: replicas 2, CPU 70% HPA | 기준 `main`의 확인된 Order Deployment는 `replicas: 1`, 서비스별 HPA 매니페스트는 저장소 트리에서 확인되지 않음. dev 자원 제약에 따른 1개 운영안을 인프라 초안에서도 언급함 | **설계·현행 매니페스트 차이**, HPA 구현 완료로 표시 금지 |
| Redis 사용 | Inventory 확보 만료 보조·Cooking 혼잡 캐시 제안 | Redis 매니페스트는 존재. 기준 `main`의 Inventory·Cooking `build.gradle`에는 Redis 스타터가 없고 Inventory는 DB 만료 스케줄러를 구현. 캐시 사용 완료로 쓰지 않음 | **설계 대비 구현 공백**, 정책 변경 여부 확인 필요 |
| GitOps | Actions→GHCR→Kustomize→Argo CD 자동 배포 목표 | 서비스별 Base/Overlay 및 일부 dev Application이 반영됐다. dev 자동 Sync 정책 [#210](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/210)은 **main 병합**. Menu·Frontend 신규 dev Application [#211](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/211)은 아직 리뷰 중으로 초기 실제 Sync·Pod·DB 검증 및 공통 정책 정렬이 남는다. | **부분 구현**, 전체 자동배포·실환경 검증 완료 아님 |
| 모니터링·로그 | Prometheus/Grafana/Loki/Alloy | 공통 규칙 [#146](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/146), dev kube-prometheus-stack [#185](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/185), Cooking ECS JSON 로그 [#190](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/190)이 **main 병합**됐다. | **main 반영**, 실제 수집·대시보드 검증은 별도 |

## 5. 문서와 실제 `main` 사이 불일치 — 수정 권장

1. **Order API/ERD:** OR-08·09의 구현 [#170](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/170) 이후, 과거 초안의 미구현 표기와 Flyway V6 누락을 보완한 [문서 PR #183](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/183)이 **main에 병합**됐다. 과거 문서 불일치는 해결된 항목이며 실제 dev 관리자 접근 가능 여부는 별도로 검증한다.
2. **Notion 원본 동기화:** Git의 `docs/api/notion-draft.md`, `docs/erd/notion-draft.md`에는 일부 개발 중 확인된 계약을 보완했지만 Notion 원본은 수정 날짜가 더 과거인 구간이 있다. 변경 이력은 남기되, 팀 승인 없이 초안과 구현 차이를 자동으로 '최종 기획 변경'으로 승격하지 않는다.
3. **Menu 관리자·Inventory·웹 연동:** Menu 관리자 ME-03~07 Draft의 계약(특히 ME-07 `/status`)은 통합·승인이 필요하다. Inventory #143의 IN-04 **입고만 지원** 정책은 병합돼 구현 계약과의 차이를 명세에 구분해 기록한다. 고객 HTTP는 #148 병합, #233·#240 리뷰 진행으로 각각 상태를 나눠 추적한다.
4. **인증·관리자 노출:** Auth 세션 코드는 `main`에 있지만 서비스 간 신원·권한 검증과 Gateway 연결이 끝나기 전에는 관리자 API의 임시 비활성 정책을 유지한다. 활성 배포/인가 테스트를 통과한 뒤 관련 계약 문서와 매니페스트를 갱신한다.
5. **통합 배포·운영 검증:** 신규 마이그레이션·외부/내부 API·이벤트·NetworkPolicy·이미지·Argo CD 상태는 별도 dev 실험 결과를 기록한다. 코드 병합, 컨테이너 게시, Argo CD Sync, 종단 간 PASS를 서로 바꿔 쓰지 않는다.

## 6. 참고 문서와 변경 추적 경로

- 최초 기획: [요구사항](https://app.notion.com/p/40f2f07e9478807e9247f4aa28eb3348), [API 명세 초안](https://app.notion.com/p/4102f07e9478802f91a4da2ae18ab56f), [ERD 초안](https://app.notion.com/p/4102f07e947880fb87eac2ab3ffc68a2), [설계 결정 기록](https://app.notion.com/p/40f2f07e947880e79b0bd511e54367a5), [인프라 설계](https://app.notion.com/p/4152f07e9478808c96a9e1c69482a5b7).
- Git 문서: [API 보존/보완본](api/notion-draft.md), [ERD 보존/보완본](erd/notion-draft.md), [이벤트 계약](events/notion-draft.md), [배포 안내](../deploy/README.md), [공통 개발 규칙](../CLAUDE.md).
- 실제 구현의 최종 기준: **해당 서비스 `controller`/`dto`/`service`, `src/main/resources/db/migration`의 Flyway SQL 및 병합된 PR diff**. 상세한 변경/승인/테스트 근거는 위 연결된 PR과 이슈를 참조한다.

## 7. 개발 중 업데이트 절차

1. API·DB·이벤트·프론트엔드 계약·배포 정책이 최초 확정 기획과 다르게 **변경되거나 추가로 구체화**되면 해당 기능 PR에서 이 문서를 함께 수정한다.
2. 변경 항목에는 아래 필드를 기록한다. API·ERD·이벤트 명세 자체가 달라졌다면 관련 `docs/api/`, `docs/erd/`, `docs/events/` 문서도 같은 PR에서 갱신한다.
3. Draft/미병합 변경은 **진행 중 또는 제안**으로 표시한다. main 반영 및 dev 통합 검증 표시는 실제 증거를 확인한 후 각각 따로 업데이트한다.
4. 최종 구현·통합 검증이 끝나면 [관리 Issue #193](https://github.com/ktcloud-cloudnative-2026/team02-5xx/issues/193)의 체크리스트와 실제 코드·Flyway·배포 상태를 대조하고 Close한다.

### 변경 항목 기록 양식

| 일자 | 영역/대상 | 변경 전(기획/기존 계약) | 변경 후 | 사유·영향 범위 | 관련 Issue/PR | main 반영 | dev 검증 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| YYYY-MM-DD | API·DB·이벤트 등 | 기존 내용 | 새 계약·구조 | 이유·영향 서비스 | #번호 | 미반영/반영 | 미검증/PASS/BLOCKED |

---

**관리 원칙:** 이후 계약이 달라질 때는 `기준일 / 변경 전 / 변경 후 / 이유 / 관련 이슈·PR / main 병합 여부 / dev 통합 확인 여부`를 함께 남긴다. 특정 PR이 병합되면 해당 행의 상태를 바꾸되, 실제 배포·종단 간 검증은 별도 증거 없이 완료 표시하지 않는다.