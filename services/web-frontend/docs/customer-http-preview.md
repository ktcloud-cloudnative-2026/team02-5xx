# #252 수동 검수용 HTTP 미리보기

제품 App·실제 Menu/Auth/Checkout/Order/CO-01 HTTP adapter와 기존 loopback fixture를 사용한다.
실제 dev Gateway·백엔드·DB가 아닌 **로컬 메모리 샘플 응답**이다. 제품 React 코드에 테스트 응답을 넣거나 인증을 주입하지 않는다.

```powershell
cd services/web-frontend
npm.cmd run test:customer:ui
```

터미널에 출력된 `http://127.0.0.1:<임시 포트>`를 연다. 최초 진입은 고객 홈이다.
고정 포트에 의존하지 않으며 서버를 다시 실행하면 URL/포트가 바뀔 수 있다. 서버는 loopback에만 바인딩한다.

## 테스트 계정

| 역할                           | 이메일                | 비밀번호              |
| ------------------------------ | --------------------- | --------------------- |
| CUSTOMER                       | customer@example.test | fixture-only-password |
| STORE_ADMIN                    | admin@example.test    | fixture-only-password |
| 다른 CUSTOMER (초기 주문 없음) | other@example.test    | fixture-only-password |

실제 계정이 아니다. 기존 Auth HTTP fixture의 로그인·쿠키 복원·로그아웃을 그대로 사용한다.
샘플 21개 주문은 첫 CUSTOMER 소유다. 비회원은 주문 API 401, STORE_ADMIN은 403, 다른 CUSTOMER의 상세 접근은 404다.
새로 만든 주문도 로그인한 고객 소유로 보관한다. 생성/실패 상태는 목록에서 제외하고 결제 성공 후 홈·목록·상세에서 조회할 수 있다.

## 혼잡도와 Checkout 시나리오 전환

같은 페이지 맨 아래 **로컬 HTTP fixture · 실제 백엔드 데이터가 아닙니다** 검수 도구를 이용한다.

1. 혼잡도 시나리오에서 정상(대기 3건·조리 중 1건·조리 시작까지 2분), 혼잡(12건·1건·15분 1초), 0건/0초 또는 오류(503)를 선택한다.
2. **시나리오 적용**을 누른다. 적용 완료 안내를 확인한다.
3. 홈의 **혼잡도 새로고침**을 누른다. 오류에서 회복하려면 정상으로 적용한 뒤 **혼잡도 다시 시도**를 누른다.

전환은 fixture 응답만 바꾸며 제품 화면/세션을 교체하지 않는다. 도구의 POST는 loopback 테스트 경로에만 있고 제품 API가 아니다.
변경한 시나리오는 동일한 서버를 사용하는 모든 탭에 공유된다. 서버를 다시 시작하면 정상/success와 샘플 주문으로 초기화된다.
Checkout 시나리오도 같은 도구에서 선택한다. 기본 success, 결제 실패 declined, 결과 불명 unknown/unknown-paid, 재고/판매 오류 stock/closed/unavailable, 확보 만료 expired, 예상시간 오류 estimate-error, 처리 중 in-progress를 유지한다.
CLI의 기존 `npm.cmd run test:customer:ui -- declined` 형식도 유지한다.

## 브라우저에서 확인할 기능

- 비회원 홈의 혼잡도·로고/메뉴 탐색·장바구니, 로그인 안내.
- CUSTOMER 로그인 후 최근 TEST 주문 → 기존 주문 상세의 옵션·기본가·수량·합계·Cooking 상태/예상 시간.
- 전체 주문 목록의 페이지네이션(초기 21개), 상세 닫기·뒤로가기. 대기 샘플은 취소할 수 있고 조리 중 샘플은 차단된다.
- 메뉴 선택·장바구니·Checkout 생성/모의 결제 → 새 HTTP-CONTRACT 주문의 상세·홈 최근 주문 반영.
- 혼잡도 정상/혼잡/0건과 오류·재시도, 로그아웃과 STORE_ADMIN 고객 주문 제한.
- 모바일 화면과 동일 URL 새로고침 후 세션 복원.

## 재사용과 검증

`customer-http-preview.mjs`가 기존 `customer-http-fixture.mjs`를 preview 옵션으로 시작한다.
CO-01과 OR-03/04/05를 같은 서버에 연결했으며, 기존 `order-history-browser.mjs`의 주문 샘플 함수를 fixture로 옮겨 양쪽에서 공유한다.
`auth-http-fixture.mjs`는 기존 테스트 계정 검증을 유지하고 검수 도구만 `ui-fixture.mjs`에 전달한다. 공유 UI fixture는 제품 기본 SVG 파일도 제공한다.
일반 자동 테스트에는 검수 도구/초기 주문을 추가하지 않는다. 고객 메뉴·기존 생성/결제 시나리오와 HTTP 요청 기록은 유지한다.

`customer-preview.test.js`는 Node에서 공개 CO-01·시나리오 전환·실제 DTO 검증·권한/소유권·등록/결제 후 조회·취소를 검증한다.
`customer-preview-browser.mjs`는 `CUSTOMER_PREVIEW_URL`에 지정한 **실제 npm 실행 서버**에 접속하며 별도 서버/요청 가로채기/세션 주입 없이 도구와 제품 화면을 조작한다.
브라우저 QA는 기존 외부 Playwright 설치를 사용하며 제품 의존성을 추가하지 않는다. 결과는 저장소 밖 `%TEMP%\peak-order-252-preview`에 보관한다.

서버의 메모리 샘플·조리 상태는 실제 Cooking 진행·환불·DB 동시성·Gateway 인증 성공을 증명하지 않는다.
