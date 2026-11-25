# 고객 재고·주문 가능 상태 — Issue #264

- 브랜치 `feat/264-customer-stock-availability`, 기준 `origin/main`의 `6d1713c`.
- #257 `1b10e55`, #260 `18a9512`, 기존 미추적 서비스별 bin 디렉터리를 보존했다. #256·#258·#262의 미병합 코드는 포함하지 않았다.
- 계약 기준: Inventory README, `InventoryController`, `InventoryQueryService`, `AvailabilityResponse`, API/ERD 설계 문서. 백엔드·인프라·관리자·API 계약·의존성 변경 없음.
- 사용자 검수 및 후속 명시적 지시 전 Commit·Push·PR 생성 금지. 향후 PR은 재고 정합성 관련 필수 리뷰 대상이다.

## 구현 동작

`inventoryApi.js`는 같은 출처의 공개 IN-01 GET을 호출한다. 양의 정수 ID를 중복 제거하고 최대 100개씩 나눠 요청한다. success/data 봉투, 요청한 ID와 응답의 일치, 누락·중복·미요청 ID, boolean orderable과 0~2147483647 정수 availableQty 및 두 필드의 일관성을 검사한다. 잘못된 배치가 하나라도 있으면 전체 조회를 실패 처리하며 품절로 변환하지 않는다. 자동 재시도는 없고 화면에서 명시적으로 재조회한다. timeout·AbortSignal과 응답 세대 검사로 취소·오래된 결과를 차단한다.

목록은 정상 판매 상태를 유지하며 재고 0·주문 불가에 품절, Menu PAUSED에 판매 중지, 조회 실패에 재고 확인 불가를 표시한다. 품절 메뉴도 상세 조회 가능하다. 상세는 수량 초과 안내와 담기·바로 주문 차단을 제공한다. 담기는 같은 메뉴의 기존 장바구니 전체 수량을 포함하고 바로 주문은 선택 수량만 비교한다. 옵션·가격 계산은 기존 로직을 사용한다.

장바구니는 같은 메뉴의 모든 옵션 라인 수량을 합산해 가용 수량과 비교한다. 품절·부족·판매 중지 항목도 화면과 저장소에 유지하며 사용자가 수량 수정·삭제할 수 있다. 재고 조회 실패도 기존 항목과 수량을 변경하지 않는다. 판매 중지 항목을 표시·편집·저장할 때만 명시적 allowPaused 옵션을 사용하며, 신규 담기와 Checkout 검증은 ON_SALE을 요구한다. 기존 잘못된 ID·비활성 옵션·비공개 메뉴 검증 정책은 유지한다.

주문 진입 직전에 별도 최신 IN-01 조회를 수행한다. 부족·품절·조회 실패면 Checkout 진입을 차단하고 안내한다. 중복 클릭은 한 번만 조회하며, 메뉴 닫기·탐색·장바구니 수량 변경·세션 변경·unmount는 이전 시도를 무효화한다. 조회는 재고 예약이 아니며 Order 서버의 최종 재고 확보 결과가 최종 판단이다.

## 실행 및 화면 검수

```powershell
cd C:\M\Peak_Order\services\web-frontend
npm.cmd run test:stock:ui
```

실행 후 Vite React 미리보기: <http://127.0.0.1:5264/?scenario=mixed#menu-list>

이 모드는 실제 App/HTTP 클라이언트와 가상 Inventory·Menu·Auth·Order HTTP fixture를 사용한다. 실제 Inventory 서버 연결 성공을 의미하지 않는다. 시나리오 선택은 **검수 전용 진입점**에서만 가상 장바구니를 초기화하며 제품 진입점에는 포함되지 않는다. 개발 중인 다른 장바구니와 겹치지 않도록 전용 5264 origin을 사용한다.

| query scenario | 가상 데이터와 확인 순서                                                                                                                        |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| mixed          | 클래식 버거 재고 10, 더블 치즈 0, 치킨 2, 머시룸 PAUSED. 목록 표시 → 품절 상세 → 치킨 수량 3 선택 → 장바구니 5개 옵션 라인 보존·주문 차단 확인 |
| normal         | 재고 50, 클래식 2개 장바구니. 로그인 → 주문하기 → 최신 재고 조회 후 기존 Checkout 확인                                                         |
| sold           | 클래식 재고 0·장바구니 1개. 상세 동작 차단, 장바구니 삭제·수량 수정 가능 확인                                                                  |
| short          | 클래식 재고 3·단품 2개+세트 2개. 합계 4개 부족 표시 → 한 라인 1개로 줄여 합계 3개 주문 허용 확인                                               |
| paused         | 머시룸 판매 중지·장바구니 1개. 품절과 구분, 수량 수정·삭제 가능 확인                                                                           |
| error          | Inventory HTTP 503. 품절 오표시 없이 조회 실패·명시적 재시도, 항목·수량 보존 확인                                                              |

화면 위 시나리오 링크를 선택하거나 URL의 scenario 값을 바꾼다. 가상 로그인은 `customer@example.test` / `fixture-only-password`다. 같은 주소를 브라우저 모바일 모드 390px·320px에서도 확인한다. 초기 데이터 외의 수정은 이 전용 origin과 fixture 프로세스에서만 유지된다.

## 검증 및 실제 환경 구분

- Node 계약·HTTP fixture·기존 회귀: `npm.cmd test`
- Chromium: 외부 기존 Playwright 패키지 경로 `PLAYWRIGHT_PACKAGE`, 저장소 밖 스크린샷 경로 `STOCK_QA_OUTPUT` 설정 후 `node tests/stock-browser.mjs`
- 기존 `auth-browser.mjs`, `customer-http-browser.mjs`, `guest-cart-browser.mjs`, `order-history-browser.mjs`로 로그인·메뉴·장바구니·Checkout·주문 내역 회귀 확인
- `npm.cmd run build`, 변경 파일 Prettier, `git diff --check`. Windows 기존 CRLF 파일은 무관한 수정 없이 `npm.cmd run format:check -- --end-of-line auto`로 전체 포맷 검사
- 로그·스크린샷: 저장소 밖 `C:\M\Peak_Order-stock-264-qa`

검증 결과: Node 227개(신규 29개), 신규 Chromium 9개 시나리오, 기존 4개 Chromium 회귀 스위트 통과. 데스크톱·390px·320px 스크린샷을 확인했고, 실행 중인 Vite 주소에서도 6개 시나리오가 실제 렌더링되는지 확인했다. production build·변경 파일 Prettier·전체 줄바꿈 자동 판별 Prettier·diff 검사도 통과했다.

실제 서버 연결은 기존 Vite의 `INVENTORY_API_TARGET` 또는 `GATEWAY_API_TARGET`을 사용한다. 승인된 실제 개발 서버 주소를 설정한 별도 Vite 실행은 fixture 실행과 구분한다. 실제 Inventory/Gateway 접근·배포 데이터·주문 경합 E2E는 이번 로컬 fixture 검증에 포함되지 않았다.
