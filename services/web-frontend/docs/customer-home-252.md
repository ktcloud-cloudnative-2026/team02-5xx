# 고객 홈·혼잡도·공통 탐색 — #252

기준은 Issue #252, main `eac2e88c7da2ed894689d4868713467c975ee3f4`, `docs/api/notion-draft.md`의 홈/공통 헤더와 실제 CookingController·CongestionResponse·CookingDashboardService다.
현재 Worktree에 없는 시안은 `C:\M\Peak_Order\design-reference\menu-ui\01_HOME (로그인 전).png`를 읽기 전용으로 확인했다.
환영 문구·혼잡도 카드·회원별 행동의 구성을 참고하되 3단계 혼잡도·영업시간·가짜 회원가입/찾기 링크는 추가하지 않았다.

## 화면과 재사용

- 최초 hash 없는 진입과 `#home`은 홈이다. 로고는 홈으로 이동한다. 기존 `#menu-list`, `#cart`, `#checkout`, `#orders[/id][?page=N]`는 유지한다.
- 기존 고객 App의 로그인/로그아웃·장바구니 버튼을 공통 헤더로 옮겼다. Home의 로그인도 기존 LoginModal·Auth 세션을 사용한다. 주문 내역의 중복 로그아웃만 App에서 숨기며 단독 컴포넌트 기본값은 유지한다.
- 비회원도 메뉴·장바구니를 이용한다. CUSTOMER만 최근 주문을 조회한다. STORE_ADMIN에게 고객 주문·결제/개인 주문 조회를 허용하지 않는다. 기존 주문 진입 시 CUSTOMER 인증 정책은 그대로다.
- 최근 주문은 기존 createOrderApi의 OR-03 첫 페이지(size=20)를 한 번 조회해 서버 최신순 첫 항목만 요약한다. 새 API·별도 DTO·개별 OR-04 선행 조회는 만들지 않았다. 상세 링크는 기존 주문 상세 컴포넌트로 이동한다. 전체 목록에 대한 불필요한 홈 폴링을 하지 않고 홈 재진입/세션 변경에 새로 조회한다.
- 기존 orderHistoryStore의 인증/권한 오류·요청 세대·AbortSignal·세션 변경 방어와 orderStatus·금액 표시를 재사용한다. 세션 epoch와 고객 키로 Home 요약을 분리해 동일 계정의 로그아웃/재로그인도 이전 요청을 복원하지 않는다.
- 메뉴 화면을 숨겨도 검색·정렬·카테고리와 장바구니 상태는 App에 남는다. 열린 상세는 홈으로 이동할 때 useDialog를 일시 비활성화하고 돌아오면 같은 옵션·수량으로 복원한다. 주문 내역으로 이동할 때 상세 정리는 기존 동작을 따른다.
- 홈에서 연 장바구니는 닫으면 홈으로 돌아간다. 공통 탐색은 기존 hash/History 이벤트를 재사용하며, 앵커 기본 스크롤이 이전 화면의 저장 위치를 덮어쓰지 않게 한다. 페이지별 스크롤·제목 포커스와 건너뛰기를 제공한다. Checkout History 복구/재결제 방지와 주문 상세의 자체 History 처리는 기존 코드에 맡긴다.
- 회원가입·비밀번호 찾기·마이페이지는 범위 밖이다. 가짜 화면이나 비활성 목적지 링크를 추가하지 않았다.

## CO-01 계약·갱신

`GET /api/v1/cooking/congestion`에 같은 Origin 공개 요청을 보낸다. `credentials: omit`, `cache: no-store`이며 Authorization·쿠키·신원 헤더/요청 본문이 없다.
`success:true`, 문자열 message, data의 NORMAL/CROWDED enum과 waitingCount·cookingCount·expectedWaitSec의 비음수 safe integer를 검증한다.
서버 long 중 JS 정밀도를 벗어나는 값도 실패로 처리한다. 알 수 없는 level을 NORMAL로 추정하거나 서버 혼잡 임계값을 프론트에서 계산하지 않는다.

expectedWaitSec는 지금 주문했을 때 **조리 시작까지**의 예상 초다. 분/초로 표시하고 조리 완료/개인 주문의 남은 시간으로 표현하지 않는다.
NORMAL이어도 대기 주문이 있을 수 있다. 0건/0초는 정상 응답에서 확인된 경우만 표시한다.

- 기본 timeout 10초. HTTP 오류·JSON/envelope/data 오류·네트워크·timeout을 구분하고 retry 가능 안내를 제공한다. 외부 취소는 조회 실패로 표시하지 않는다.
- 홈이 보이고 문서가 visible일 때만 조회한다. 성공 완료 30초 후 다음 요청을 예약한다. 진행 중 새로고침은 비활성화하고 중복 요청을 막는다.
- 오류 시 자동 타이머를 중단한다. 명시적 재시도 또는 화면/탭 재진입으로 한 번 다시 조회한다. 네트워크 장애를 자동 무한 요청으로 증폭하지 않는다.
- 이전 성공값이 있다면 마지막 확인 정보·이전 갱신 시각·최신 아님을 함께 표시한다. 최초 실패는 알 수 없음이며 숫자/혼잡도 기본값을 만들지 않는다.
- 탭 숨김/홈 이탈/언마운트는 요청·타이머를 취소하고 세대를 무효화한다. 취소를 무시한 늦은 성공·오류도 최신 홈 상태를 덮어쓸 수 없다.

## 로컬 검증

Node 영향 범위: home.test.js, ui.test.js, order-history.test.js, dialogFocus.test.js, dialogScroll.test.js, checkout-bundle.test.js, auth-boundary.test.js, session.test.js — **87 PASS**.
신규 CO-01/폴링 46건과 기존 공유 App·Auth·주문·모달·제품 번들 경계를 포함한다. 기존 전체 Node/Chromium을 반복하지 않았다.

Chromium은 실제 App의 기존 Auth/Menu/Checkout loopback HTTP fixture를 재사용했다.
Home suite **15 PASS**: 정상/혼잡/0건·오류/timeout/retry·숨김/폴링·늦은 응답·역할·최근 주문/세션 변경·History·전체 주문 동선·390/320px를 검증했다.
기존 guest-cart **16 PASS**·order-history **16 PASS**도 공통 헤더/탐색/useDialog 영향 범위의 회귀로 확인했다. Chromium 합계 **47 PASS**, 실패/BLOCKED 0이다.
기존 메뉴 목적의 브라우저 QA 5개 파일은 초기 URL만 `#menu-list`로 명시해 최초 진입의 새 Home 정책과 구분한다.
Vite build·변경 파일 Prettier·Git diff 공백 검사도 통과했다. 화면 캡처/JSON은 저장소 밖 `%TEMP%\peak-order-252-qa`에 둔다.

## 실제 dev 배포 의존성

기존 `COOKING_API_TARGET` 또는 `GATEWAY_API_TARGET`으로 Vite의 `/api/v1/cooking` 프록시를 설정할 수 있다. 설정하지 않으면 로컬 Vite가 실제 CO-01을 제공하지 않으며 Home은 조회 오류와 재시도를 표시한다.
배포 Gateway/HTTPRoute의 CO-01 공개 경로·실제 Cooking 상태·TLS/동일 Origin을 이번 fixture 검증으로 증명하지 않는다.
Order의 검증된 사용자 전달/Gateway 인증 의존성도 그대로다. 실제 dev 사용자 주문·결제 성공을 주장하지 않는다.
백엔드·DB·Gateway·인프라·#132·#251 브랜치는 수정하지 않았다. 새 라이브러리·관리자 API 차단 해제·Commit·Push·PR 생성·main 병합은 범위 밖이다.
