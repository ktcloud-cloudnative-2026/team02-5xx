# 관리자 대시보드 #302

## 범위와 실행

- 브랜치: `feat/302-admin-dashboard-ui`, 기준 `origin/main` `316a404`.
- 고객 `App`·인증·라우팅 및 기존 관리자 메뉴 코드는 변경하지 않는다. 미병합 #262/#267/#279/#298/#299 코드를 가져오지 않는다.
- `npm run preview:admin-dashboard` → **http://127.0.0.1:5302/**. 루프백 전용, Vite 메모리 빌드 + 독립 HTTP fixture. 고객 `dist/`를 덮어쓰지 않는다.
- 위 주소는 **실제 Order/Cooking/Inventory/Auth/Gateway 연결 및 관리자 인증 성공이 아니다**. 기존 재고 미리보기 `127.0.0.1:5284`와 별도 프로세스이며 이를 수정·중지하지 않는다.
- 화면 하단 `HTTP fixture 시나리오`에서 정상/빈 목록/부분 장애/401·403·404·503/메뉴 이름 조회 실패/변경 거절/변경 결과 불명/지연을 선택한다. 선택 시 fixture 데이터와 대시보드 수명주기를 초기화한다.
- 정상에서 영업·접수 스위치를 각각 전환하고, 결과 불명 시나리오에서는 `현재 서버 상태 확인`을 누른다. 390px/320px에서는 대기열 표 안에서 가로 스크롤할 수 있다.
- 기본 포트 사용 중이면 `DASHBOARD_PREVIEW_PORT`로 별도 포트를 지정할 수 있다.

## 실제로 확인한 디자인 원본

저장소 **루트** `design-reference/menu-ui/`의 원본을 열어 대조했다. Issue에 언급된 frontend 하위 경로 대신 실제 원본 위치를 사용했다.

| 파일                                                                   | 확인 및 반영                                                                                                                                       |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WF_관리자 · 대시보드 1.png` / `.svg`                                  | PNG 직접 확인, SVG를 Chromium에서 렌더링해 확인. 흰 사이드바, 검정 활성 탐색, 회색 바탕, 흰 카드, 영업 스위치, FIFO 표와 재고 알림 2열 구성을 반영 |
| `WF_관리자 · 메뉴관리 1.png` / `.svg`                                  | PNG·SVG 렌더링 확인. 둥근 모서리, 검정 버튼, 연회색 표 헤더, pill 배지와 간격을 반영                                                               |
| `WF_관리자 · 주문 조리 현황 1.png`                                     | PNG 직접 확인. 대기·조리 구분과 관리자 화면 톤을 참고. 지원되지 않는 조리 조작은 추가하지 않음                                                     |
| main에 병합된 #132 `src/components/admin/admin.css` / 관리자 메뉴 화면 | 레이아웃·타이포·색상 대조. 기존 독립 Mock 미리보기 이동을 Chromium에서 검증. 원본 컴포넌트·CSS는 변경하지 않음                                     |

API에 있는 조리 중 KPI를 더해 5개 지표를 표시한다. 모바일에서는 카드와 본문을 세로로 배치하고 사이드바를 수평 탐색으로 전환한다. CSS는 `.ad-*`로 격리한다.

## 계약과 HTTP 계층

Issue #302, `docs/api/notion-draft.md`, 실제 main Controller/DTO/Service를 기준으로 했다.

| 영역         | 실제 경로                                             | 사용하는 data 필드                                                                                                 |
| ------------ | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| OR-06        | `GET /api/v1/admin/store/operations`                  | `isOpen`, `acceptingOrders`, `updatedAt` (KST; null은 미제공)                                                      |
| OR-07        | `PATCH /api/v1/admin/store/operations`                | 요청은 선택한 **한 필드만** `{isOpen: boolean}` 또는 `{acceptingOrders: boolean}`. 응답은 OR-06과 동일             |
| CO-01        | `GET /api/v1/cooking/congestion`                      | `level: NORMAL/CROWDED`, `waitingCount`, `cookingCount`, `expectedWaitSec`                                         |
| CO-03        | `GET /api/v1/admin/cooking/overview`                  | `waitingCount`, `cookingCount`, `completedToday`, `canceledToday`, `expectedWaitSec`, 생략 가능한 `cookingOrderNo` |
| CO-04        | `GET /api/v1/admin/cooking/queue`                     | `count`, `items[{position,orderId,orderNo,queuedAt,estimatedCookSec}]`                                             |
| IN-02        | `GET /api/v1/admin/inventory/items?lowStockOnly=true` | `stockItemId`, nullable `menuId`, `stockQty`, `reservedQty`, `availableQty`, `lowStockThreshold`, `lowStock`       |
| ME-01 (보조) | `GET /api/v1/menus?sort=default`                      | 기존 `createMenuApi` 검증을 재사용해 공개 메뉴 `id/name/status`만 추출                                             |

실제 근거: Order `AdminStoreOperationController`, `StoreOperationResponse`, `UpdateStoreOperationRequest`, `StoreOperationService`; Cooking `CookingController`, `CookingAdminController`, `CongestionResponse`, `CookingOverviewResponse`, `CookingQueueResponse`; Inventory `InventoryAdminController`, `StockItemResponse`, `InventoryAdminService`, `Inventory.isLowStock()`; 기존 Menu HTTP 어댑터와 ME-01 계약.

- 성공 envelope(`success/data/message`), HTTP 200, 필수 불린/열거형/비음수 정수·안전한 ID·유효 날짜를 검증한다. 재고 수식, 부족 기준, 중복 ID, FIFO position/count 및 등록 시각 순서를 검증한다.
- 동일 queuedAt의 순서는 서버 `position`을 유지한다. DTO에 없는 Cooking ticket ID를 추정하거나 주문 ID 순으로 재정렬하지 않는다.
- 예상 대기는 **조리 시작까지**이며 완료 예상시간이 아니다. CO-01과 CO-03은 독립 조회이므로 다른 시점일 수 있음을 표시한다. 오늘 완료·취소는 서버 KST 집계값을 그대로 사용한다.
- 서버 변경 시각과 프론트 조회 완료 시각을 별도로 표시한다. 주문 상품·고객 정보·진행률·재고 이름 등 없는 필드를 만들지 않는다.
- 재고 부족과 `availableQty === 0` 품절을 구분한다. 공개 메뉴에 없는 ID는 ID + 이름 조회 불가, 미연결은 메뉴 미연결로 표시한다. 메뉴 조회 실패가 검증된 재고 수량을 지우지 않는다. 이전 메뉴 이름을 유지하면 이전 조회값임을 명시한다.
- 기본 어댑터는 same-origin fetch/credentials, redirect:error를 사용하며 신원 헤더를 만들지 않는다. 향후 인증된 HTTP 요청 함수를 `createDashboardApi({request})`에, 어댑터를 `AdminDashboard api`에 주입할 수 있다. 관리자 인증/공유 dev 활성화/제품 라우팅은 구현하지 않는다.

## 상태 변경·실패·폴링

- 영업과 접수는 독립 필드다. 영업 종료 + 접수 true 응답도 그대로 표시하고 신규 주문은 받지 못하는 상태임을 안내한다. 다른 필드를 임의로 바꾸지 않는다.
- 낙관적 토글 없이 서버 응답으로만 반영한다. 제출 중 두 스위치를 잠그고 중복 요청을 막는다. 키보드 제출 후 다른 곳으로 이동하지 않았다면 응답 후 포커스를 복원한다.
- PATCH를 앱에서 자동 재전송하지 않는다. 400/401/403/404는 명확한 거절로 표시한다. 5xx/네트워크/12초 timeout/성공 응답 파싱·계약 불일치는 결과 불명으로 취급한다.
- 결과 불명에서는 두 스위치를 잠그고 이전 값을 최신 상태로 단정하지 않는다. 자동 운영 상태 폴링도 멈추며, 사용자의 명시적 GET 확인 이후 필요한 변경을 다시 선택하게 한다. 확인 GET 실패 시 계속 결과 불명으로 유지한다.
- fixture의 연결 끊김은 서버 변경 후 **응답 일부 전송 중 연결 종료**로 재현한다. 헤더 전송 전 빈 응답만으로 연결을 끊으면 Chromium 자체 transport retry가 발생할 수 있으므로, 애플리케이션 재전송 검증과 혼동하지 않는다. 정확한 1회 전송은 HTTP fixture의 PATCH 카운터로 확인한다.
- 같은 영역 GET은 진행 중 요청을 공유한다. 영역별 generation/AbortController와 화면 수명주기로 오래된 GET/PATCH의 적용을 차단한다. 화면 종료로 이미 전송한 PATCH를 되돌렸다고 간주하지 않는다. 재마운트 시 이전 PATCH 결과를 적용하지 않고 새로운 GET을 수행한다.
- 프로젝트 `home/congestionStore.js` / `docs/customer-home-252.md`의 **성공 완료 후 30초 setTimeout** 방식을 적용했다. 여섯 조회 영역은 독립적으로 갱신한다. 실패 영역은 자동 반복을 멈추고 수동 재조회 또는 visibility 복귀로 재개한다. 다른 정상 영역은 계속 갱신한다.
- 문서 hidden 시 GET과 타이머를 중지하고 visible 복귀 시 즉시 조회한다. unmount 시 전부 정리한다. SSE나 임의의 빠른 재시도 루프는 추가하지 않는다.
- 401/403은 해당 영역의 이전 데이터도 지우고 인증/권한 오류를 표시한다. 그 외 조회 실패는 이전 값과 마지막 조회 시각에 경고를 붙이며 실패를 0/품절로 표시하지 않는다.

## 탐색·인증 경계와 미검증 사항

- 메뉴 관리로 이동한 뒤 대시보드로 복귀할 수 없는 기존 독립 미리보기 탐색 문제는 **#304 관리자 공통 레이아웃·라우팅 통합**으로 이관한다. #302는 독립 기능 범위로 검수 승인되었으며, 임시 localhost 복귀 링크나 기존 메뉴 화면 수정은 포함하지 않는다.

- 메뉴는 main #132의 **기존 독립 Mock 서버**에만 명시적으로 연결한다. URL은 fixture 시작 시 동적으로 제공하며 실제 관리자 인증 성공으로 표현하지 않는다.
- 주문/재고/조리 화면은 현재 main에서 통합 가능한 제품 라우팅이 없으므로 `연동 준비 중`으로 표시한다. 미병합 #267/#279/#299 코드나 #298 모달 코드를 가져오지 않았다. 향후 `navigation` prop으로 정식 메뉴 경로를 제공할 수 있다.
- 실제 Order/Auth/Gateway/Cooking/Inventory dev E2E, JWT 신뢰 경계와 STORE_ADMIN 인증 성공, 다중 관리자 동시 변경, 실제 재고 이벤트·자정 KST 집계는 **미검증**이다. 공유 dev 관리자 API를 활성화하거나 Gateway 설정을 바꾸지 않았다.
- #279 주문·#299 재고 화면의 대시보드 통합 이동은 미병합 의존성 때문에 **BLOCKED/범위 외**다. 재고 5284 미리보기는 별도로 보존한다.

## 검증

- Node 전체 **408 PASS** (기존 347 + 신규 HTTP 계약·오류·상태 테스트 61). 기존 관리자 메뉴 어댑터·렌더링·dialog 테스트도 포함된다.
- 대시보드 Chromium **22 PASS**: 1440/390/320px, 표/배지/메뉴 미연결, 두 스위치, 중복 제출, 거절·응답 불명, 명시적 재확인, 401/403/404/503, 지연, 이전 값 보존·재시도, 늦은 응답, 폴링/hidden, Space/포커스, 기존 #132 Mock 이동.
- 고객 Chromium 회귀: 로그인 9, HTTP Checkout 23, 비회원 장바구니 16, 주문 내역 16, 홈 15 = **79 PASS**. 회원가입 **13 PASS**.
- Vite 제품 Build, 별도 대시보드 fixture 메모리 Build, Prettier, diff 검사를 수행한다. 제품 dist에 대시보드/fixture/Node HTTP 서버 코드가 포함되지 않는지도 확인한다.
- 외부 QA 산출물: `C:/M/Peak_Order-admin-dashboard-302-qa/`. 스크린샷과 테스트 결과 JSON/로그는 저장소에 추가하지 않는다.

## 변경 파일과 보존

- `src/admin-dashboard/`: 독립 React 화면/CSS, HTTP DTO 검증, 영역별 상태·폴링.
- `preview/admin-dashboard/`: fixture 전용 React 진입점/HTML/검수 시나리오 선택.
- `tests/admin-dashboard.test.mjs`, `tests/admin-dashboard-fixture.mjs`, `tests/admin-dashboard-browser.mjs`.
- `scripts/admin-dashboard-preview.mjs`, `package.json`의 실행 스크립트 2개, 이 문서.
- 기존 서비스 `inventory-service/bin/`, `order-service/bin/`, `payment-service/bin/` 미추적 파일과 다른 브랜치/worktree를 보존한다. 사용자 검수 전 Commit/Push/PR은 만들지 않는다.
