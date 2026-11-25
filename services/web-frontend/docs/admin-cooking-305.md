# 관리자 주문·조리 현황 #305

## 범위와 기준

- `feat/305-admin-cooking-ui`, 최신 확인 main `98fec06`에서 독립 개발. #302는 `49a19ec` / PR #306에 보존했다. #262/#267/#279/#298/#299/#306의 코드나 커밋을 가져오거나 변경하지 않았다.
- 종료 점검 중 origin/main이 `d1a80a2`로 갱신되었다. 추가 2커밋(#295/#292)은 Order 종료 보호·모니터링/관측 문서의 5개 파일이며 frontend/API 계약과 겹치지 않는다. 로컬 #305 미커밋 구현을 유지하고 추가 merge를 수행하지 않았다. #306은 최신 base에서 CLEAN/MERGEABLE 및 CI 성공을 확인했다.
- Cooking 조회 전용 화면이다. 영업·접수 토글, 조리 시작·완료 변경, 주문 상세, 임의의 조리 담당자·고객 정보·진행률은 추가하지 않는다.
- `CookingPage`는 **본문만 제공**한다. 독립 미리보기의 사이드바는 `preview/admin-cooking/`에만 있다. 고객 App/인증/라우터와 main #132 관리자 메뉴는 변경하지 않는다.
- #304 확정 댓글의 통합 목표 경로는 `#admin/cooking`이다. 대시보드 `#admin`, 메뉴 `#admin/menus`, 주문 `#admin/orders`, 재고 `#admin/inventory`와 함께 향후 AdminLayout에 연결한다. 이번에는 다른 화면 이동을 실동작 링크로 만들거나 localhost를 소스에 하드코딩하지 않는다.

## 직접 확인한 디자인

실제 위치는 저장소 루트 `design-reference/menu-ui/`이다.

- `WF_관리자 · 주문 조리 현황 1.png` 직접 확인, 동명 `.svg`를 Chromium에서 렌더링해 확인했다. 흰 120px 사이드바, 회색 배경, 둥근 KPI 카드, 검정 조리 중 강조, 좌측 조리 현황·우측 대기열 구성과 버튼·상태 배지 톤을 반영했다.
- main #132 `src/components/admin/admin.css` 및 기존 메뉴 관리 시안과 색상/타이포/카드 간격을 대조했다. #302 때 확인했던 대시보드/메뉴 PNG·SVG도 시각적 기준으로 참고했다. 미병합 #302 소스를 복사하지 않는다.
- API는 조리 중 목록·완료 예상 시각·남은 시간·관리자 조리 조작을 제공하지 않는다. 따라서 시안의 해당 표 열/버튼을 구현하지 않고, 대표 조리 주문번호와 시간 의미 안내를 배치했다.
- 오늘 취소 KPI를 추가했다. 모바일 390/320px에서는 KPI 2열, 조리·대기열 1열, FIFO 항목 카드와 내부 세로 스크롤을 제공한다. CSS는 `.ac-*`로 격리한다.

## 실제 API와 의미

근거: `docs/api/notion-draft.md`, main의 `CookingController`, `CookingAdminController`, `CongestionResponse`, `CookingOverviewResponse`, `CookingQueueResponse`, `CookingDashboardService`, `CookingQueryService`, `ClockConfig`.

| 구분  | 경로                                 | data 및 표시 의미                                                                                                                                         |
| ----- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CO-01 | `GET /api/v1/cooking/congestion`     | `level` NORMAL/CROWDED, `waitingCount`, `cookingCount`, `expectedWaitSec`. 지금 새로 주문하면 **조리 시작까지** 걸리는 예상 시간이며 완료까지 시간이 아님 |
| CO-03 | `GET /api/v1/admin/cooking/overview` | `waitingCount`, `cookingCount`, `completedToday`, `canceledToday`, `expectedWaitSec`, 생략/nullable `cookingOrderNo`                                      |
| CO-04 | `GET /api/v1/admin/cooking/queue`    | `count`, `items[{position,orderId,orderNo,queuedAt,estimatedCookSec}]`. WAITING 전표의 서버 FIFO 순서                                                     |

- 완료·취소 건수는 Cooking 서버가 KST 오늘 0시 이후 집계한 값이다. 프론트 시계로 집계 건수를 계산하지 않는다.
- `cookingOrderNo`는 서버가 제공하는 대표 조리 주문번호 1개다. 조리 중 건수가 여러 건이어도 임의의 추가 주문번호를 만들지 않는다. 조리 0건+번호 없음은 `없음`, 조리 양수+번호 생략은 `주문번호 미제공`, 조회 실패는 `확인할 수 없어요`로 구분한다.
- CO-04는 현재 조리 중 전표를 포함하지 않는다. position 1이 다음 조리 대상이다. 동일 queuedAt에서는 서버 position을 유지하며 주문 ID로 다시 정렬하지 않는다.
- `queuedAt`은 날짜·초·KST를 명시한다. UTC 응답도 Asia/Seoul로 표시한다. `estimatedCookSec`는 각 주문 자체의 예상 조리 소요시간이다. 접수 후 경과 시간, 시작/완료 ETA, 현재 조리의 잔여시간을 만들어내지 않는다.
- 공통 envelope(`success/data/message`), HTTP 200, 안전한 비음수 정수, 유효 ISO 달력/시간대, nullable 번호, count/items 일치, 중복 ID/주문번호, position 및 FIFO 등록 시각을 검증한다. 성공 DTO의 필요한 필드만 추출한다.
- 공개 CO-01 검증과 초→분/초 표시는 main의 `home/congestionApi.js`를 재사용한다. main 파일은 수정하지 않는다.
- CO-01·03·04는 동일 시점의 원자적 스냅샷이 아니다. 마지막 조회 성공 시각을 각 영역에 표시하고, 건수·예상 대기가 불일치하면 조회 시점 안내를 표시한다. 한 응답으로 다른 영역의 값을 덮어쓰거나 합계를 추정하지 않는다.

## 오류·동시성·접근성

- HTTP 어댑터는 GET만 제공한다. API 성공을 가짜 관리자 세션으로 만들지 않는다. 공개 조회는 credentials:omit, 관리자 조회는 same-origin이며 redirect:error, cache:no-store를 사용한다. 신원 헤더를 생성하지 않는다. 향후 인증된 request 함수를 주입할 수 있다.
- 관리자 401/403은 해당 영역의 이전 값을 지운다. 비활성/경로 없음 404, 400, 5xx, 네트워크, 10초 timeout, envelope/DTO 오류를 구분하고 재조회할 수 있다.
- 그 외 조회 실패는 기존 데이터와 마지막 성공 시각을 유지하고 `이전 조회값`을 표시한다. 실패를 빈 목록·0건·조리 없음으로 바꾸지 않는다. 다른 정상 영역은 계속 동작한다.
- main `home/congestionStore.js`와 일관되게 **조회 성공 완료 후 30초** 타이머를 사용한다. 실패 영역은 자동 반복을 멈추고, 수동 재조회 또는 visibility 복귀로 재개한다. 불필요한 즉시 자동 재시도는 없다.
- 영역별 진행 중 GET을 공유해 수동/주기 갱신이 겹쳐도 중복 전송하지 않는다. hidden/unmount에서는 타이머와 GET을 취소하며 버전으로 abort를 무시하는 늦은 응답도 차단한다. visible 복귀 시 즉시 새 조회를 한다.
- 향후 계정/인증 어댑터 교체 시 상위 통합 화면은 새 api/store를 제공해야 한다. 본 독립 화면은 고객 세션이나 관리자 인증을 임의 구현하지 않는다.
- 새로고침 중 aria-disabled/aria-busy를 적용해 키보드 포커스를 유지하고 중복 조작을 무시한다. 오류 재시도 버튼이 사라질 때 다른 곳으로 이동하지 않았다면 해당 상태 영역으로 포커스를 복원한다. 건너뛰기 링크는 main을 포커스하고 hash를 바꾸지 않는다. FIFO 영역은 Tab으로 접근해 키보드로 스크롤할 수 있다.

## 미리보기와 검수 순서

`npm run preview:admin-cooking` → **http://127.0.0.1:5305/#admin/cooking**

- 루프백 전용 HTTP fixture이며 **실제 Cooking/Auth/Gateway 인증·API 성공이 아니다**. Vite 메모리 빌드로 고객 dist를 덮어쓰지 않는다. 포트는 `COOKING_PREVIEW_PORT`로 조정할 수 있다.
- 하단 시나리오 선택: 정상 → 빈 목록 → 조리 여러 건 → 번호 생략 → 조회값 불일치 → 각 영역 503 → 401/403/404 → 네트워크/DTO 오류 → 지연/10초 timeout.
- 정상에서 새로고침·대표 주문·FIFO 순서·KST·각 시간의 의미를 확인한다. 재시도를 통한 정상 복구는 일반 시나리오로 전환하거나 테스트에서 해당 fault를 해제한다. 오류 시나리오를 유지한 재조회는 계속 같은 오류를 재현한다.
- 390/320px에서 카드 배치와 대기열 스크롤, Tab/Shift+Tab·건너뛰기·새로고침 포커스를 검수한다.
- 기존 재고 5284·대시보드 5302는 별도 메모리 서버로 보존한다. #305와 화면 간 왕복 연결을 하지 않는다.

## 검증 결과

- Node 전체 **397 PASS**: 기존 main 347 + 신규 Cooking HTTP 계약·오류·상태 50. #302의 미병합 테스트 61개는 가져오지 않아 총수가 다르다.
- Cooking Chromium **21 PASS**: 정상/빈/번호 생략/조리 여러 건/FIFO, 조회값 불일치, 401/403/404/503/네트워크/DTO/timeout, 지연·중복 조작, 이전 데이터/재시도 포커스, 늦은 응답, 30초 폴링/hidden, 키보드, 1440/390/320px.
- 기존 고객 Chromium **79 PASS**: 로그인 9 + HTTP Checkout 23 + 비회원 장바구니 16 + 주문 내역 16 + 홈 15. 회원가입 **13 PASS**.
- Vite 제품 Build, 별도 fixture 메모리 Build, 관리자 제품 번들 경계 검사, Prettier, tracked/new diff 검사를 수행한다. 제품 dist에서 `admin-cooking`, fixture 컨트롤, Node HTTP 서버가 유입되지 않는지도 확인한다.
- QA 로그/결과 JSON/스크린샷은 저장소 밖 `C:/M/Peak_Order-admin-cooking-305-qa/`에 보존한다.

## 미검증·보존

- 실제 Order/Cooking/Auth/Gateway dev E2E, STORE_ADMIN 인증·JWT 신뢰 경계, 실제 자동 조리 전이·재고 이벤트 및 자정 KST 집계는 미검증이다. `COOKING_ADMIN_ENABLED=false` 기본 정책과 공유 dev/prod를 변경하지 않았다.
- 실제 관리자 공통 라우팅, 화면 왕복 탐색, 인증 가드·History 통합은 #304의 후속 범위다. 이를 성공했다고 표시하지 않는다.
- 변경: `src/admin-cooking/` 5개, `preview/admin-cooking/` 3개, `tests/admin-cooking*` 3개, preview 스크립트, package 실행 스크립트 2개, 이 문서.
- 기존 브랜치/worktree·서비스 bin 미추적 파일을 보존한다. #305는 사용자 화면 검수 전 Commit·Push·PR을 생성하지 않는다.
