# 고객 주문 내역·상세·취소 — #236

## 기준과 범위

- Issue #236, 미병합 PR #233의 `fb6fdef9b1b896b3923029e7b4dd6f45bda762aa`에서 `feat/236-customer-order-history`를 생성했다. 기존 Worktree를 사용하며 #233 브랜치·원격 PR은 변경하지 않는다.
- `docs/api/notion-draft.md` OR-03·04·05와 실제 OrderController·OrderSummaryResponse·OrderDetailResponse·OrderCancelService를 대조했다. 새 API·의존성·백엔드 변경은 없다.
- 현재 Worktree에 없는 디자인 자료는 `C:\M\Peak_Order\design-reference\menu-ui\WF_주문 내역 1.png`, `11_주문 상세 (모달) 2.png`를 읽기 전용으로 확인했다. 목록 카드·상태 배지·중앙 상세 모달을 따르고 현재 메뉴·장바구니 스타일을 재사용한다.

## 화면과 계약

- 사이드바 **주문 내역** → `#orders`, 페이지는 `#orders?page=1`, 상세는 `#orders/123?page=1`. 페이지·주문 ID를 URL로 복원하며 잘못된 주소는 API를 호출하지 않는다. 상세 닫기·뒤로가기 시 목록 페이지·포커스를 복원한다.
- OR-03: `GET /api/v1/orders?page={page}&size=20`. 서버 최신순을 유지한다. 주문번호·일시·금액·대표 메뉴·항목 수·상태, 페이지네이션·빈 목록·로딩·오류·재시도를 제공한다. `itemCount`는 총 주문 수량이 아닌 항목 수로 표시하며 실제 수량은 상세에서 확인한다. 결제 전 취소로 주문번호가 없는 CANCELED도 처리한다.
- OR-04: `GET /api/v1/orders/{id}`. #233의 `validateOrder`를 재사용해 `(unitPrice + 옵션 extraPrice 합) × quantity = lineAmount`와 총액·ID를 검증한다. 기본가·옵션가·수량·합계와 주문/결제/취소/완료 시각을 표시하며 누락 시각은 미제공으로 표시한다.
- Cooking은 최상위 expectedWaitSec가 아닌 `cooking.expectedWaitSec`(시작까지), `expectedReadySec`(완료까지)를 조회 시점 기준으로 표시한다. COOKING/DONE은 시작됨, DONE은 조리 완료로 표시한다. PENDING·UNAVAILABLE·누락/잘못된 Cooking은 확정 시간으로 바꾸지 않는다.
- Order CANCELED/FAILED/COMPLETED를 우선한다. Cooking DONE은 픽업 대기이며 Order COMPLETED로 추정하지 않는다. 상세가 열려 있고 문서가 보이며 정상 조회·미종료 상태일 때만 10초마다 조회한다. 확인 팝업·취소 요청·결과 재확인 대기·조회 오류·종료/이탈 시 폴링을 멈춘다.
- Checkout의 HTTP 성공 화면에서 **주문 내역에서 확인**으로 해당 주문을 연다. 기존 완료 History entry를 교체해 재결제 진입을 막으며 Mock 완료에서는 실제 주문 내역 링크를 제공하지 않는다.

## 취소·권한·경합

- OR-05는 확인 후 본문 없는 `POST /api/v1/orders/{id}/cancel`이다. CREATED 또는 Order PAID/WAITING이고 Cooking OK/WAITING으로 확인된 경우에만 활성화한다. 조리 상태를 모르는 경우에는 먼저 재조회한다. CREATED의 결제 요청 여부는 공개 DTO에 없으므로 최종 판단은 서버의 ORDER_PAYMENT_PENDING 등을 따른다.
- 요청 중에는 중복 POST를 막는다. 검증된 CANCELED 응답만 취소 성공으로 채택하고 목록·상세를 다시 조회한다. CANCELED는 환불·재고 복원 완료 증거가 아니며 이를 완료로 표시하지 않는다.
- 409 조리 시작/완료·접수 중·결제/취소 독점과 503/네트워크/응답 이상은 오류를 안내하고 같은 주문을 재조회한다. 결과가 계속 불명이라면 자동 취소·자동 새 주문·자동 POST는 하지 않는다. 사용자가 **취소 결과 다시 확인**으로 성공한 GET을 확인한 뒤에만 새 확인 절차를 통해 다시 요청할 수 있다.
- 기존 Auth `request`, CUSTOMER 식별, LoginModal과 useDialog의 포커스·Escape·스크롤 잠금을 재사용한다. GET만 401 갱신·최대 1회 재시도를 허용하고 POST는 허용하지 않는다. 403은 로그인 실패와 구분한다. 프런트 X-User-Id·결제 키·내부 Payment/Inventory 호출은 없다.
- 계정·세션 변경, 요청 교체, 모달 이탈 뒤의 응답은 AbortSignal과 요청 세대·소유자 검사로 차단한다. 이전 주문·취소 응답으로 다른 계정 화면을 채우지 않는다. 주문 취소는 기존 장바구니를 변경하지 않는다.

## 검증과 한계

- `node --test tests/order-history.test.js tests/ui.test.js tests/checkout-bundle.test.js`: 신규 16 + App SSR 8 + 제품 번들 경계 1, 총 25건.
- `tests/order-history-browser.mjs`: 기존 Auth/Menu/Checkout loopback fixture와 실제 App entry를 재사용한다. 신규 주문 HTTP/화면 및 영향 범위의 장바구니·Checkout 완료 탐색 16개 시나리오를 Chromium에서 확인한다. 별도 Mock 프레임워크나 인증 우회를 제품에 추가하지 않는다.
- 기존 Checkout Mock의 성공 시나리오 1개만 선택 회귀한다. #233의 Node 177·Chromium 98 전체는 재실행하지 않는다.
- 변경 파일 기본 Prettier, Vite production build와 diff 공백 검사를 수행한다. 결과·스크린샷은 저장소 밖 로컬 검증 디렉터리에 보존한다.

실제 dev Auth·Gateway의 검증된 Bearer 사용자 전달과 Order의 임시 X-User-Id 계약은 여전히 연결되지 않았다. HTTP fixture 성공을 실제 dev 주문·취소·환불 성공으로 주장하지 않는다. 서버의 취소 후속 스케줄러·실제 Cooking 경합도 dev 통합에서 별도 실증해야 한다. Commit·Push·PR·병합은 이번 작업에서 하지 않는다.
