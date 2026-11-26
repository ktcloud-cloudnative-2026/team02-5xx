# Peak Order — 기획 대비 개발 변경사항 정리

> **작성·현황 확인 기준일:** 2026-11-26 (KST)  
> **계속 관리:** [Issue #193 — 기획 대비 개발 변경사항](https://github.com/ktcloud-cloudnative-2026/team02-5xx/issues/193)  
> **비교 기준:** 2026-11-13 전후 확정된 Notion 요구사항·API·ERD·설계 결정 및 저장소 `docs/api/notion-draft.md`, `docs/erd/notion-draft.md`  
> **구현·병합 상태 확인 기준:** GitHub `main` [`340cda0`](https://github.com/ktcloud-cloudnative-2026/team02-5xx/tree/340cda00ba01fe61ab0aa8db233071fcb0024277), 2026-11-26 오전 확인. 개발 Discord 11/19~26 협의와 담당자 보고, 관련 PR·Issue 및 확인한 SQL/명세를 대조한 1차 최신화이며 전체 소스·실환경 재검증은 후속이다.
> **과거 스냅샷:** 최초 `ca43852`, 11/23 확인 `0c65ed0`. 이후 변경은 아래에 반영한다.
> **목적:** 초기 설계와 실제 개발 계약의 차이, 변경 이유, 문서 반영 필요 항목을 기록한다. **구현 여부와 실제 dev/prod 배포·통합 검증 여부는 별개**다.

## 0. 판정 기준 및 범위

| 표기 | 뜻 |
| --- | --- |
| **main 반영** | 위에 명시된 확인 커밋의 `main`에 해당 코드·문서·매니페스트가 존재함 |
| **PR 진행** | 2026-11-26 확인 시 별도 PR이 열려 있으며, 최신 확인 시점 `main`에 포함되지 않음 |
| **설계와 구현 차이** | 현재 코드와 기획·설정의 불일치 또는 미반영 상태. 팀 합의에 따른 최종 변경은 아닐 수 있음 |
| **실환경 미확인** | 코드·테스트/문서만 확인했으며 dev/prod 종단 간 동작을 단정할 수 없음 |

**주의: 기획 단계의 변경을 개발 단계 변경으로 중복 계산하지 않는다.** 2026-11-09에 백엔드 3개 중심 구상에서 Auth·Menu·Order·Inventory·Payment·Cooking **6개 MSA + React 프론트엔드**로 재설계하고, 혼잡도를 Cooking에 통합하고, 서비스별 독립 DB·모의 결제·재고 분리를 확정한 것은 *개발 전 기획 변경*이다. 11/13 기준으로 이미 결정된 사항이며 이후 코드를 구현했다고 해서 새로 바뀐 설계로 기록하지 않는다. 참고: [설계 결정 기록](https://app.notion.com/p/40f2f07e947880e79b0bd511e54367a5), [아키텍처](https://app.notion.com/p/40f2f07e9478800e9985d80e19ebe7d2).

## 1. API 및 서비스 계약 변경·구체화

### 1-1. Auth — JWT 세션의 구체적인 전달·보안 계약 (main 반영)

- **기획:** AU-01 로그인/JWT 발급, AU-02 내 정보, AU-09 재발급, AU-10 로그아웃. 토큰 저장·회전·검증키·HTTP 응답 세부는 추가 설계 대상.
- **구현 상세:** Access Token은 **RS256 JWT(15분)**, Refresh Token 원문은 **쿠키로 전달**하고 DB에는 **SHA-256 해시**만 저장한다. Refresh는 세션 단위 회전·폐기, 기억하기(`rememberMe`)에 따른 만료(기본 1일/기억하기 14일)를 사용한다. `GET /api/v1/auth/jwks` 공개 검증키 조회가 추가됐다. `GET /api/v1/auth/me`는 Bearer Access Token을 요구하며, `POST /api/v1/auth/logout`은 공통 JSON이 아닌 **204 No Content + 쿠키 삭제**를 반환한다.
- **이유:** 브라우저에서 재발급 토큰을 직접 노출하지 않고, 중복 사용·세션 경쟁·서명 검증을 명확히 처리하기 위해서다.
- **현황:** AU-05·06 회원정보·비밀번호 변경은 [#221](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/221) 병합, [#249](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/249) dev 반영. 비밀번호 변경은 모든 활성 Refresh를 폐기하되 기존 Access가 즉시 무효화되는 것은 아니다. AU-03·04 회원가입/중복 조회와 dev 시연용 약관 demo-v1([#269](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/269)), 공개 JWKS 및 세션 배포 상태는 [Auth 계약](api/auth-session-contract.md)([#214](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/214), [#356](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/356)) 참고. AU-07·08 복구는 별도 후속 범위다. HTTPS 브라우저 세션 통합 검증은 [#287](https://github.com/ktcloud-cloudnative-2026/team02-5xx/issues/287)에서 추적한다.
- **근거:** [PR #164](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/164), [SessionController](https://github.com/ktcloud-cloudnative-2026/team02-5xx/blob/main/services/auth-service/src/main/java/com/peakorder/auth/controller/SessionController.java), [Auth 구현 메모](https://github.com/ktcloud-cloudnative-2026/team02-5xx/blob/main/docs/api/auth-session-implementation-plan.md).

### 1-2. Menu — 고객 조회·구매 검증의 상세 계약 (main 반영)

- **ME-01 `GET /api/v1/menus`:** 기획의 '판매 메뉴 목록'을 구체화해 `categoryId`, `query`, `sort=default|priceAsc|priceDesc`를 지원한다. **ON_SALE·PAUSED는 조회하고 HIDDEN은 제외**한다. 카테고리를 함께 반환하며 필터·정렬·동률 처리 및 빈 목록·잘못된 쿼리 오류를 명시했다. 현재 구현은 페이지네이션하지 않는다.
- **ME-02 `GET /api/v1/menus/{menuId}`:** PAUSED는 상세 **조회 가능**하나 주문 가능하다는 뜻은 아니다. HIDDEN/없는 메뉴는 404, 옵션의 `isDefault`·`active`, null 값의 응답 규칙을 상세화했다.
- **MI-01 `POST /internal/v1/menus/validate-purchase`:** 주문·조리 시간 계산에 필요한 `unitPrice`, `cookTimeSec`, 옵션별 `extraPrice`, `extraCookTimeSec`, `optionName`을 요청 순서대로 내려주도록 계약을 구체화했다. 실제 주문 금액·조리 시간 계산은 프론트엔드 값을 신뢰하지 않는다.
- **MI-02 `GET /internal/v1/menus/{menuId}/existence`:** Inventory 메뉴 연결 시 **존재·판매 상태를 확인**하는 내부 API로 확정했다.
- **ME-03~07 관리자:** [#251](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/251)에서 목록/상세/등록/수정/상태 변경을 통합했다. ME-07은 `PATCH /api/v1/admin/menus/{menuId}/status`, 별도 DELETE 대신 HIDDEN 상태 변경. 등록/수정 트랜잭션과 행 잠금, 공통 권한 검사 포함. 제품 신뢰 경계 기본 403 유지; [#280](https://github.com/ktcloud-cloudnative-2026/team02-5xx/issues/280)/[#360](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/360) dev 활성화는 진행 중이다.
- **기획과의 관계:** 고객·내부 API는 구현 상세 확정이며, 품절/가용 수량 판단은 Inventory 책임이다.
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

**관리자 노출 정책:** Order OR-06~09는 `ORDER_ADMIN_ENABLED=false` 기본 및 dev 관리자 경로 비공개 유지. [#265](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/265)에서 고객/관리자 신원·역할 검사를 구현했고 [#303](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/303)에서 고객 주문 경로에 JWT 검증을 적용했다. Inventory·Cooking은 각각 [#337](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/337)·[#349](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/349)에서 dev 관리자 경로만 JWT 필수로 공개했으며 base/prod 기본 차단은 유지한다. Menu는 [#251](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/251)에서 업무 API를 통합했지만 제품 기본 403이며 [#360](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/360)은 미병합이다. 개별 서비스의 활성화·검증 상태를 혼동하지 않는다.

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
- **Inventory 외부 API 추가:** [#143](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/143)·[#202](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/202)로 IN-01~06 구현, IN-04는 양수 입고만, IN-05는 메뉴 연결/해제, IN-06은 논리 삭제(초기 204 제안과 달리 실제 InventoryAdminController는 200 + ApiResponse<StockItemResponse> 반환). RESERVED·CONFIRMED 예약이 남은 연결은 변경·삭제 409(STOCK_ITEM_IN_USE)로 제한해 취소 복원 정합성을 보존한다. [#232](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/232)는 동시 요청의 저장 충돌을 기존 확보 결과 또는 409로 처리한다. [#247](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/247) 관리자 권한 검사 및 [#337](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/337) dev JWT 경로 적용. 상세는 [Inventory README](../services/inventory-service/README.md).
- **검증 범위:** 11/24 dev 정상 주문·결제·조리 전체 백엔드 흐름은 [#259](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/259) 댓글에서 확인된다. 취소·장애·브라우저 Gateway E2E 전체 통과를 의미하지 않는다.

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
| **Inventory V2** | `inventories.deleted_at TIMESTAMPTZ` (NULL 허용), 삭제 시 메뉴 연결 해제·행/이력 보존 | 11/19 논리 삭제 협의 및 IN-06 구현. 미삭제 항목만 관리자 목록에 포함. [#202](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/202); [실제 SQL](../services/inventory-service/src/main/resources/db/migration/V2__add_inventories_deleted_at.sql) |
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

**dev 검증(담당자 보고):** [#259](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/259) 댓글에 11/24 Order→Payment/Inventory→EV-01→Cooking→EV-02→Order COMPLETED 정상 흐름 및 DLQ 0 기록. port-forward·직접 신원 헤더 시험이며 브라우저 E2E는 별도다. 11/25 [#313](https://github.com/ktcloud-cloudnative-2026/team02-5xx/issues/313) 다중 Pod 시험에서는 전표 중복 없음, 동시 조리 1건 제한, Pod 삭제 후 정상 완료가 보고되었다. 거의 동시에 결제된 주문의 등록 순서는 바뀔 수 있으며 FIFO 기준은 Cooking DB `queued_at,id`로 유지한다([#332](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/332), [이벤트 계약](events/notion-draft.md)).

## 4. 프론트엔드·인프라에서 설계와 달라진/추가된 점

| 구분 | 기획/정책 | 기준 main 코드·변경 사항 | 판정 |
| --- | --- | --- | --- |
| 장바구니 | 프론트 저장, 로그인 없이 담기 가능 | `localStorage` 키 `peak-order.cart.v1`, 버전 및 `{menuId, optionIds, quantity}` 저장. 결제/주문 시 로그인 모달 정책. [#116](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/116) | **main 반영**. 기획 변경이 아닌 저장 포맷 확정 |
| 실제 메뉴 HTTP 연동 | 고객 메뉴를 API로 표시 | ME-01/02 HTTP 연동 [#148](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/148)이 병합됐다. 로딩·재시도·오래된 응답 차단과 장바구니 데이터 보존 처리를 포함한다. | **main 반영**, 실제 dev 연동 검증은 별개 |
| 정적 이미지·기본 메뉴 이미지 | 미리 정한 기본 이미지와 정적 파일 제공 | [#220](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/220)에서 공통 메뉴 이미지 대체 경로, 기본 SVG 및 정적 이미지 경로를 구성했고 main에 병합됐다. | **main 반영**, 브라우저 이미지 실패 전환·실배포 Gateway HTTP 200은 별도 검증 |
| 고객 HTTP 연동 | Auth·Menu·Order·Cooking·Inventory 연동 | [#233](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/233) 세션·Checkout, [#240](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/240) 주문 내역·상세·취소, [#256](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/256) 홈·혼잡도, [#258](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/258) 회원가입, [#262](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/262) 마이페이지, [#267](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/267) 재고 표시, [#331](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/331) 고객 UX·비JSON 인증 오류 대응. | **main 반영**, 최신 dev 이미지·HTTPS E2E는 별도 |
| 관리자 화면/API | 메뉴·재고·주문·조리 관리 | [#132](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/132) 관리자 Menu Mock UI, [#251](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/251) 관리자 API 기본 차단 구현. [#279](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/279) 주문, [#299](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/299) 재고, [#306](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/306) 대시보드, [#311](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/311) 조리, [#340](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/340) 관리자 레이아웃·역할 라우팅 병합. Menu 실제 인증/HTTP 활성화 여부는 [#280](https://github.com/ktcloud-cloudnative-2026/team02-5xx/issues/280)/[#360](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/360) 후속 검증. | **main 부분 반영**, 관리자 전체 E2E 미검증 |
| 재고 관리자/고객 조회 | IN-01~06 | [#143](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/143)·[#202](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/202) 전체 외부 API, [#232](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/232) 동시성, [#247](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/247) 권한, [#317](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/317) 공개 IN-01, [#337](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/337) 관리자 JWT dev 노출. 고객은 `orderable`과 Menu 판매 상태를 함께 판단하고 관리자는 menuId로 메뉴 정보를 결합. | **main 반영**, dev 일부 검증 |
| 인프라 네트워크 보안 | Gateway 단일 공개 진입·내부 서비스 경로 차단 | `peakorder`에 **기본 Ingress 차단 + 필요한 서비스별 Ingress만 허용**하는 NetworkPolicy 추가. Egress는 차단하지 않음. [#166](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/166) | **main 반영**, 실클러스터 적용/검증 별도 |
| RabbitMQ 환경 변수 | 공통 RabbitMQ 서비스/컨테이너 | K8s Service 환경변수가 앱의 `RABBITMQ_PORT`를 덮는 충돌 발견. Deployment의 `enableServiceLinks: false`로 변경. [#161](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/161) | **main 반영**, 구현 트러블슈팅 |
| dev Pod/HPA | 초기 replicas 2, CPU 70% HPA | [#186](https://github.com/ktcloud-cloudnative-2026/team02-5xx/issues/186) 합의: min 1/max 3/CPU 70%, 서비스별 자원·DB 풀·다중 Pod 안전성·종료 보호·Argo CD replicas 비교 제외 선행. Order [#320](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/320), Cooking [#332](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/332), Inventory [#341](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/341), Auth [#353](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/353) 병합. Menu·Payment HPA는 후속. | **4개 서비스 main 반영**, 검증 범위는 아래 참조 |
| Redis 사용 | Inventory 확보 만료 보조·Cooking 혼잡 캐시 제안 | Redis 매니페스트는 존재. 11/23 확인 기준의 Inventory·Cooking `build.gradle`에는 Redis 스타터가 없었고 Inventory는 DB 만료 스케줄러를 구현. 캐시 사용 완료로 쓰지 않음 | **추가 확인 필요**, 11/23 조사 당시 앱 Redis 사용 근거 미확인 |
| GitOps | Actions→GHCR→Kustomize→Argo CD | [#211](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/211)·[#213](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/213) Menu/Web·Inventory Application 추가, [#210](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/210)·[#291](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/291) 자동 Sync. [#282](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/282) 소스 변경 서비스의 dev 태그 PR 자동 생성. 11/25 토큰 미등록으로 PR 생성 지연, 11/26 강사 승인 후 자동 PR [#373](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/373) 생성 확인(5개 서비스, 미병합). | **구현·자동 PR 생성 확인**, 승인/병합·Sync·새 이미지 검증 별도 |
| 모니터링·로그 | Prometheus/Grafana/Loki/Alloy | [#185](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/185) kube-prometheus-stack, [#206](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/206)·[#237](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/237) RabbitMQ 지표/DLQ, [#285](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/285)·[#310](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/310) Cooking/Order 지표, [#292](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/292)·[#346](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/346) 알림, [#330](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/330) Loki·Alloy. ECS JSON 로그 [#190](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/190)·[#274](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/274)·[#325](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/325). | **main 반영**, 11/23~25 담당자 Sync·수집 보고, 모든 서비스 수집 완료는 아님 |

## 5. 2026-11-26 1차 추가 대조 — 계약·운영·검증

### 5-1. 공통 인증과 브라우저 정책

- [#112](https://github.com/ktcloud-cloudnative-2026/team02-5xx/issues/112) 11/24 종료: Gateway JWT A안과 신원 헤더 계약 확정. JWT sub → X-User-Id(양의 정수 문자열), role → X-User-Role(CUSTOMER/STORE_ADMIN). 보호 경로는 claimToHeaders가 클라이언트 신원값을 덮어쓰고, 공개 경로의 임의 신원 헤더는 제거한다. Gateway JWT 실패는 일반 텍스트 401, 서비스 신원 오류 401/역할 부족 403/타 사용자 주문 404. 내부 API 외부 노출 금지. 허용 내부 호출자의 사칭 위험·role 누락 토큰 시험 등은 잔여 신뢰 경계 검증이다. [#286](https://github.com/ktcloud-cloudnative-2026/team02-5xx/issues/286), [#303](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/303), [Auth 계약](api/auth-session-contract.md).
- 11/19~25 브라우저 합의: Access 메모리, Refresh HttpOnly·Secure·SameSite=Strict·Path=/api/v1/auth, 출처 검증(HTTPS 또는 루프백 HTTP), 회전·절대 만료. 동시 Refresh 한 건만 200, 재사용은 같은 세션 전체 폐기. [#344](https://github.com/ktcloud-cloudnative-2026/team02-5xx/issues/344) 2 Pod 직접 시험으로 확인. 만료 Refresh 행 자동 삭제는 미구현(11/25 Auth 담당 보고). HTTPS 도메인/허용 Origin과 실제 브라우저 쿠키는 [#287](https://github.com/ktcloud-cloudnative-2026/team02-5xx/issues/287) 검증 대상; issuer와 브라우저 Origin은 별개다. 도메인 등록·TLS 완료 여부는 이 조사에서 확인하지 않았다.
- [#331](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/331) 프론트의 비JSON 401/403 대응: HTTP 상태 우선, 안전한 GET은 Refresh 후 최대 1회 재시도, 주문 생성/결제/취소 등 변경 요청은 자동 재전송하지 않는다. 403에는 Refresh하지 않는다. 실제 Gateway·브라우저 검증 별도.

| 관리자 API | main 기준 | dev 담당자 검증 보고 |
| --- | --- | --- |
| Menu | [#251](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/251) 구현·제품 403, [#360](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/360) 미병합 | 실제 JWT 관리자 200 미확인 |
| Inventory | [#247](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/247) 권한·[#337](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/337) dev 공개 | 11/25 무토큰·위조·잘못된 JWT 401, CUSTOMER 403, 공개 IN-01 200, Pod 직접 STORE_ADMIN 200. 실제 관리자 JWT Gateway 200은 미확인 |
| Cooking | [#288](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/288) 권한·[#349](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/349) dev 공개 | 11/25 무토큰/위조 401, 공개 CO-01 200, 허용되지 않은 메서드·내부 경로 404. CUSTOMER/STORE_ADMIN JWT·화면 검증 남음 |
| Order | [#265](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/265) 권한·[#303](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/303) 고객 JWT 경로 | 고객 JWT·신원 헤더 전달 확인 보고, 관리자 경로 기본 차단 유지 |

### 5-2. DB·운영·확장 정책

- DB Secret은 Git에 값 저장하지 않고 서비스별 Secret을 `secretKeyRef`로 참조. dev DB 담당 직접 생성 및 GitOps 선언 분리, prod 주입·관리 권한과 인계는 별도 확인. [#212](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/212)·[#213](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/213) 및 11/23 Discord 합의. 초기 dev 시드 [#218](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/218)·[#235](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/235); Inventory 담당 11/23 적용 보고: 10건, 품절 1건, 부족 2건, HIDDEN 미연결. 실제 DB 스키마·전체 시드 재검증은 후속.
- [#186](https://github.com/ktcloud-cloudnative-2026/team02-5xx/issues/186) HPA 선행 조건: 서비스 자원, Hikari 최대 4/최소 1, 종료 보호(preStop 10초/terminationGracePeriodSeconds 50초), Argo CD replicas 무시 및 RespectIgnoreDifferences, 다중 Pod 시험. 서비스별 적용을 구분한다. Payment [#363](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/363) 선행 설정 병합, Menu [#357](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/357) 미병합. 11/26 PostgreSQL max_connections 100→150 논의는 적용 결과 미확인; 롤링·HPA 최악 연결 예산 재검증 필요. Redis·스토리지 실제 사용 및 운영 인계는 별도 확인.
- 11/23 모니터링 CRD 설치 과정 cp OOM(담당자 보고), VS Code Remote-SSH 메모리 사용도 영향. cp에서는 일반 SSH/kubectl만 사용하고 무거운 Sync는 available 1Gi 이상에서 단계별 진행, 300Mi 미만 또는 API 이상 시 중단. Operator 재기동 후 Prometheus/Alertmanager 정상. 차트 CRD 라벨 예외 및 dev Operator Secret 권한 수용/후속 축소는 [#176](https://github.com/ktcloud-cloudnative-2026/team02-5xx/issues/176)·[#185](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/185). 11/25 Loki·Alloy 별도 Application 설치 및 Grafana 조회 보고([#330](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/330)); [#346](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/346) 알림 Sync 완료 보고. prod 직접 apply 금지는 유지하되 11/20 Namespace/Gateway 두 파일 한정 일회성 예외 승인(사전 PR·영향 확인·향후 GitOps 전환 조건), 실제 적용 상태는 별도 확인.

### 5-3. 통합 시험과 미검증 범위

| 일자 | 시험 및 보고 근거 | 결과·범위 |
| --- | --- | --- |
| 11/24 | [#259](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/259) 정상 주문 전체 백엔드 흐름 | CREATED→PAID→EV-01→COOKING→DONE→EV-02→COMPLETED, DLQ 0. port-forward 시험 |
| 11/25 | [#225](https://github.com/ktcloud-cloudnative-2026/team02-5xx/issues/225)·[#313](https://github.com/ktcloud-cloudnative-2026/team02-5xx/issues/313) 2 Pod/HPA 시험 | Order 동시 결제 1건 처리(나머지 409); Payment 담당 결제·환불 각 1건 확인 보고. Cooking 동시 조리 제한·중복 없음·Pod 교체 후 완료; FIFO는 DB 등록 순서. 실제 전체 쓰기 부하 시험 아님 |
| 11/25 | [#312](https://github.com/ktcloud-cloudnative-2026/team02-5xx/issues/312) Inventory, [#344](https://github.com/ktcloud-cloudnative-2026/team02-5xx/issues/344) Auth | Inventory HPA/다중 Pod 검증 담당자 보고; Auth 2 Pod JWKS 동일·교차 검증·Refresh 경쟁 200/401, 로그인 부하 419건 200, 1→3→1 확대/축소. 실제 사용자 패턴·동시 가입/비밀번호 변경 미검증 |
| 11/25 | [#337](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/337)·[#349](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/349) 관리자 JWT | 위 표의 단계별 검증. 관리자 실계정 Gateway 200 및 브라우저 E2E 남음 |

**1차 확인 한계:** 위 dev 결과는 이슈/PR 댓글과 Discord 담당자 보고를 근거로 하며, 이 문서 최신화 작업에서 클러스터를 직접 재시험하지 않았다. 11/26 Inventory 담당자 이탈 예정에 따라 Order/Payment, Menu/Frontend, Auth/Gateway, 모니터링 담당이 연동 테스트 분담을 제안했고 DB·Redis·스토리지 권한 인계는 확인 대기다. 미병합 [#357](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/357)·[#360](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/360)·[#365](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/365)·[#372](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/372) 및 자동/수동 이미지 태그 PR [#368](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/368)~[#371](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/371)·[#373](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/373)는 완료로 기록하지 않는다. [#193](https://github.com/ktcloud-cloudnative-2026/team02-5xx/issues/193)은 최종 통합 검증 및 명세 대조 완료 전 Open 유지.

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