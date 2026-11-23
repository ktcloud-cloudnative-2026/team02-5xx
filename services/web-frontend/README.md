# 피크오더 웹 프론트엔드

#201 후속 정책에서 브라우저 장바구니 담기·조회·수량 변경·삭제는 비회원에게도 제공합니다.
주문·결제만 CUSTOMER 인증이 필요하며, 상세의 **이 메뉴만 바로 주문**은 현재 선택만 주문합니다.
아래 과거 인증 경계 설명보다 [비회원 장바구니 정책과 통합 주의사항](docs/guest-cart-201.md)을 우선합니다.

Issue #201에서 고객 Menu HTTP·Auth 세션·Checkout을 제품 App으로 통합했습니다.
제품 기본 경로는 CO-02와 OR-01·02·04 HTTP adapter를 사용하며, Checkout 메모리 Mock과 합성 로그인은 제품 번들에서 제외합니다.
아래 이전 Issue별 설명·QA 수치는 당시 기록입니다. 현재 실행·계약·검증 한계는 [고객 통합 #201](docs/customer-integration-201.md)을 우선 확인합니다.

Issue #77의 고객 메뉴 UI에 Issue #110의 장바구니·localStorage 기능을 추가했습니다.
기존 카테고리·검색·가격 정렬, 상세 모달·radio 옵션·수량(1~99)·금액 표시를 재사용합니다.
Issue #145에서 고객 메뉴 ME-01·ME-02 HTTP API를 연결했습니다.
Issue #156의 AU-01·02·09·10 인증 세션과 #201의 Checkout HTTP 흐름을 함께 사용합니다.
Refresh 쿠키는 브라우저가 처리하며, Access Token은 메모리에서 관리합니다.
기본 실행은 비회원이며 장바구니는 로그인 없이 사용할 수 있습니다. 주문·결제 시도에만 CUSTOMER 로그인을 요청합니다.
[고객 메뉴 API 연동 기록](docs/customer-menu-api-145.md)과 [Auth 세션 기록](docs/auth-session-156.md)은 각 구현 당시의 계약·검증 근거입니다.
현재 통합 실행·검증 결과와 실제 Menu/Auth·Order·Cooking·Gateway 연동의 남은 의존성은 [고객 통합 #201](docs/customer-integration-201.md)을 확인합니다.

## #129 관리자 메뉴 관리 Mock 미리보기

고객 App과 별개인 관리자 React 컴포넌트·메모리 Mock adapter를 추가했습니다.
목록·검색·카테고리/상태 필터·가격 정렬, 상세·옵션, 등록·부분 수정·판매 상태 변경을 지원합니다.
제품 라우트나 실제 권한을 개방하지 않습니다. 일반 build에는 관리자 미리보기/Mock 코드가 포함되지 않습니다.

```powershell
npm.cmd ci
npm.cmd run preview:admin
```

출력된 `http://127.0.0.1:<임시 포트>`를 브라우저로 여세요. 샘플은 메모리에만 존재하며 새로고침하면 초기화됩니다.
고정 포트가 필요하면 `ADMIN_PREVIEW_PORT`를 해당 로컬 프로세스 환경에 지정합니다. 바인딩은 loopback 전용입니다.
미리보기 하단의 시나리오 도구에서 다음 조회/저장 실패·빈 목록을 확인할 수 있습니다.

```powershell
npm.cmd test
npm.cmd run format:check
npm.cmd run build
npm.cmd run check:admin-boundary
```

최신 main `eac2e88c` 통합에서 고객 Node 198건과 관리자 69건을 확인했습니다.
과거 Mock 카탈로그 즉시 표시를 가정한 관리자 SSR 기대값만 현재 고객 HTTP 로딩 상태에 맞췄습니다.
실제 Chromium은 관리자 Mock 21건과 고객 메뉴·장바구니·Checkout·주문 내역 21건을 이번 통합 코드에서 검증했습니다.
기존 관리자 Chromium 21 PASS 기록과 이번 실행 결과는 [계약 대조·통합 검증 기록](docs/admin-menu-ui-129.md)에서 구분합니다.
#240까지의 고객 기능은 main을 통해 반영했으며, 리뷰 중인 #251 백엔드 코드는 가져오지 않았습니다.
실제 API·JWT·Gateway·보호된 관리자 제품 라우트 연결은 후속 작업입니다.

## 준비 환경

- Node.js 24 LTS (`.nvmrc`: 24.22.3)
- npm 11 (`packageManager`: npm@11.19.1)
- React / React DOM 19.3.1
- Vite 8.3.8, @vitejs/plugin-react 6.3.0
- Prettier 3.10.0

아래 명령은 저장소 루트에서 이 디렉터리로 이동한 뒤 실행합니다.
Windows PowerShell 실행 정책으로 `npm`이 차단되면 `npm.cmd`를 사용합니다.

```powershell
cd services/web-frontend
node --version
npm.cmd --version
npm.cmd ci
```

직접 의존성은 정확한 버전으로 고정하며 `package-lock.json`을 Git으로 관리합니다.
체크아웃 후에는 `npm ci`로 lockfile에 기록된 의존성을 설치합니다.

## 개발 서버

```powershell
$env:MENU_API_TARGET = 'http://127.0.0.1:8080'
npm.cmd run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

브라우저에서 <http://127.0.0.1:5173>을 엽니다.
해당 주소의 실제 Menu Service가 필요합니다. 서버가 없으면 오류·재시도 화면을 표시합니다.
계약 Mock HTTP 미리보기는 `node tests/menu-api-preview.mjs`로 별도 실행합니다.
개발자 도구 Console과 Network에서 JavaScript 오류·실패한 리소스 요청이 없는지 확인합니다.
포트가 사용 중이면 `--strictPort`에 따라 오류로 종료되므로 기존 프로세스를 확인하거나 다른 포트를 지정합니다.
서버 종료는 실행한 터미널에서 `Ctrl+C`를 누릅니다.

## 포맷

```powershell
npm.cmd run format
npm.cmd run format:check
```

`format`은 이 서비스 내부 파일에 포맷을 적용합니다.
`format:check`는 파일을 수정하지 않으며 포맷이 다르면 실패합니다.
UTF-8, LF, 공백 2칸, 세미콜론, 작은따옴표, 줄 길이 80, trailing comma `all`을 사용합니다.
`.editorconfig`는 서비스 내부에만 적용하며 Markdown의 끝 공백을 유지합니다.
생성물과 lockfile은 `.prettierignore`에서 제외합니다.

## 프로덕션 빌드 및 로컬 확인

```powershell
npm.cmd run format:check
npm.cmd test
npm.cmd run build
npm.cmd run preview -- --host 127.0.0.1 --port 4173 --strictPort
```

빌드 결과는 `dist/`에 생성됩니다.
브라우저에서 <http://127.0.0.1:4173>을 열고 개발 화면과 같은 내용이 표시되는지 확인합니다.
Console과 Network에서 JavaScript 오류·실패한 리소스 요청이 없는지도 확인합니다.
Preview는 빌드 결과를 로컬에서 확인하는 서버이며 운영 배포 서버가 아닙니다.
제품 빌드의 `/api/v1/menus`는 같은 origin으로 요청합니다. 개발용 Proxy는
제품 번들에 포함되지 않으므로 실제 배포에는 Gateway/역방향 Proxy 연결이 필요합니다.
확인 후 `Ctrl+C`로 종료합니다.

## 파일 및 Git 확인

- `src/main.jsx`: React 실행 진입점과 StrictMode
- `src/App.jsx`: 카테고리·검색·정렬·메뉴 목록
- `src/components/MenuDetail.jsx`: 상세 모달·옵션·수량·총액
- `src/components/Cart.jsx`: 장바구니 항목·수량·삭제·합계·빈 상태
- `src/components/LoginModal.jsx`: 이메일·비밀번호·로그인 유지 입력과 실제 HTTP 로그인 요청
- `src/cart.js`: 항목 검증·병합·금액 계산·저장/복원
- `src/session.js`: CUSTOMER 역할 검사와 선택 상태를 보존하는 진입 의도
- `src/authApi.js`, `src/authSession.js`: AU-01·02·09·10 클라이언트와 외부 세션 Store
- `src/useDialog.js`: 상세/로그인 모달의 닫기·Escape·포커스 복귀·스크롤 처리
- `src/data/menuApi.js`: ME-01·ME-02 HTTP 요청·응답 검증
- `src/cartCatalog.js`: 비동기 상세 조회 전 장바구니 보존과 전체 재검증
- `src/data/mockMenus.js`, `src/data/menuRepository.js`: 기존 테스트용 샘플 (제품 App에서 사용하지 않음)
- `src/menu.js`: 금액 표시·계산과 수량 상한
- `src/index.css`: 시안 기반 스타일·모바일 반응형
- `vite.config.js`: React 플러그인 설정
- `index.html`: 한국어 문서와 앱 진입 HTML
- `.nvmrc`, `.editorconfig`, `.prettierrc.json`: 실행 환경 및 포맷
- `.gitignore`, `.prettierignore`: 생성물·로컬 환경 파일 제외

```powershell
npm.cmd ls --depth=0
git status --short --untracked-files=all
git status --short --ignored services/web-frontend
```

`node_modules/`, `dist/`, 로그, `.env` 파일은 Git에 포함하지 않습니다.
순수 장바구니 테스트와 계약 Mock 미리보기는 실제 백엔드 없이 실행할 수 있습니다.
저장소 공통 개발 규칙은 [CLAUDE.md](../../CLAUDE.md)를 따릅니다.

## #110 Mock 확인 방법과 설계 범위 (과거 기록)

아래는 #110 구현 당시 기록입니다. 현재 제품 App의 목록·상세는 HTTP 응답을 사용하며,
PAUSED는 상세 조회를 허용하고 영양·재료 Mock 값은 표시하지 않습니다.
#145에서 바뀐 동작은 [최신 기록](docs/customer-menu-api-145.md)이 기준입니다.

- 전체 메뉴 8개 중 머시룸 버거는 `PAUSED`로 카드 선택을 막습니다.
- `HIDDEN`인 비공개 테스트 버거는 목록과 상세 조회에서 제외합니다.
- 판매 상태는 Menu 상태이며 재고 품절을 뜻하지 않습니다. Inventory 조회는 없습니다.
- 클래식 버거 6,500원에서 세트 +2,500원, 수량 2를 선택하면 18,000원입니다.
- 비활성 라지 세트는 선택할 수 없습니다. 콜라는 추가 옵션이 없습니다.
- 더블 치즈 버거는 긴 설명·재료 스크롤 확인용입니다.
- 디저트 카테고리나 일치하지 않는 검색어로 빈 목록·전체 복귀를 확인합니다.
- 모달은 닫기·Escape로 닫을 수 있고, 키보드 포커스가 모달 내부에 머물며
  닫은 후 선택했던 카드로 돌아갑니다. 메뉴를 다시 열면 옵션·수량이 초기화됩니다.
- 잘못된 ID·HIDDEN 상세는 `getMenu`가 `null`을 반환하며 상세 모달은
  없는 메뉴 또는 판매 중지 메뉴를 받으면 복귀 안내를 표시합니다.

데이터는 ERD의 camelCase 필드(`basePrice`, `extraPrice`, `isDefault`, `active`)를
참고한 UI 샘플이며 아직 확정 API 응답 DTO가 아닙니다. 영양·재료 정보도 샘플입니다.
실제 ME-01·02 연결 시 `menuRepository.js`에서 응답을 화면 모델로 변환합니다.

루트 `design-reference/menu-ui/`의 목록 PNG와 상세 PNG 2개를 참고했습니다.
회색 배경, 카테고리 타일, 4열 카드, 분할 상세·영양·옵션 배치를 따릅니다.
장바구니는 별도 화면으로 추가했고 주문·결제·찜·실제 로그인은 생략했습니다. 그에 따라
1800px 미만에서는 목록이 남은 폭을 사용하며, 1800px 이상에서는 시안의 목록 폭을 유지합니다.
인기순 데이터가 없어 기본순/가격순을 제공하고, 메뉴명·가격은 mock 값입니다.
사진·카테고리 그림은 시안과 같은 자리표시자이며, 모바일 시안이 없어 작은 화면은
상단 메뉴 바·가로 스크롤 카테고리·2열 카드·세로 상세로 구성했습니다.

## Issue #110 장바구니 정책

- 항목은 menuId + optionIds 조합으로 구분합니다. 현재 radio 한 개 선택 정책을 유지하며
  같은 구성은 수량을 합쳐 최대 99개로 제한하고 제한 안내를 표시합니다. 다른 옵션 구성은 별도 항목입니다.
- 메뉴/옵션 이름·단가·항목 합계·전체 합계, 수량 변경·개별 삭제·빈 상태를 제공합니다.
  메뉴로 돌아가기와 브라우저 뒤로가기 시 목록 필터를 유지합니다.
- PAUSED·HIDDEN·없는 메뉴, 비활성/없는 옵션, 잘못된 ID·수량·금액은 담지 않습니다.
  추가 옵션이 없는 메뉴는 빈 optionIds를 사용합니다. 옵션이 있는 메뉴는 활성 옵션 하나를 선택해야 합니다.
- Refresh로 세션을 복원하지 못하면 비회원입니다. 장바구니/주문 시도 시 상세를 닫지 않고 로그인 안내를 겹쳐 띄워
  선택한 옵션·수량·현재 카테고리/검색/정렬 상태를 유지합니다. 안내를 닫으면 시도한 버튼으로 복귀합니다.
  취소 시 대기 동작을 지워 뒤늦은 중복 실행을 막고, 상세 선택 상태는 유지합니다.
- 로그인은 실제 AU-01과 AU-02의 성공 응답을 확인해야 세션을 갱신합니다.
  기본 앱에서 query/header/localStorage로 로그인 상태를 바꾸거나 가짜 토큰을 발급하지 않습니다.
- 로그인 상태의 UI는 테스트 전용 세션 소스를 주입해 검증할 수 있습니다. 이는 실제 인증 성공이 아닙니다.
  주문 버튼은 현재 주문이 생성되지 않는다는 안내만 표시하며 외부 요청을 하지 않습니다.

### 저장과 복원

키는 `peak-order.cart.v1`이고 형식은 아래와 같습니다.

```json
{ "version": 1, "items": [{ "menuId": 1, "optionIds": [2], "quantity": 2 }] }
```

이름·가격·개인정보·역할·토큰·비밀번호를 저장하지 않습니다. 복원 시 필요한 상세 API 응답이
모두 준비된 후 메뉴 상태·옵션·가격을 다시 확인합니다. 확인 중/통신 실패 시 원본을 보존하고
금액은 표시하지 않습니다. 로컬 저장 값은 인증이나 서버 가격 검증의 근거가 아닙니다.
없는/판매 중지 메뉴나 유효하지 않은 항목은 제외하고 사용자에게 알립니다.
손상 JSON·지원하지 않는 버전·누락 필드·접근 거부는 빈 상태와 복원 안내로 처리합니다.
저장이 실패해도 현재 React 상태는 유지하며 새로고침 시 변경이 사라질 수 있음을 알립니다.
최초 복원만으로 저장 데이터를 덮어쓰지 않고, 실제 추가/변경/삭제 시 정규화된 상태를 저장합니다.

### 자동 테스트와 로컬 UI 테스트 화면

Node 24의 내장 `node:test`와 기존 ReactDOMServer/Vite SSR 로더로 테스트합니다.
새 테스트/상태관리/인증 의존성은 추가하지 않았습니다.

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run format:check
npm.cmd run build
```

현재 자동 검사 76건이 통과했습니다(#116 기존 62건 + #145 신규 14건). 항목 구성·중복/상한·수량/삭제/합계·가격 안전 정수·판매 상태/옵션·저장 복원/예외,
비회원 대기 선택과 세션 주입 경계, SSR UI의 레이블·빈 상태·기존 메뉴 동작을 검사합니다.
SSR 검사는 실제 브라우저 클릭·dialog 포커스·반응형 레이아웃 검사를 대신하지 않습니다.

```powershell
npm.cmd run test:ui
```

위 명령은 127.0.0.1의 임의 포트에서 별도 테스트 전용 페이지를 열 수 있는 주소를 출력합니다.
fixture는 메모리에 정적 빌드한 JS/CSS를 제공하며 HMR·`/@vite/client`를 사용하지 않습니다.
소스를 수정하면 fixture 서버를 재시작해야 합니다. 제품의 `dist/`는 덮어쓰지 않습니다.
하단의 모의 세션 버튼으로 로그인된 UI와 비회원 UI를 전환합니다.
"다음 로그인 안내에서 세션 모의 주입"은 다음 안내가 열릴 때 테스트 세션만 변경해
Auth 연결 후 대기 동작이 이어지는 흐름을 확인하기 위한 기능입니다.
이 fixture는 tests/에만 있으며 배포 index.html에서 참조하지 않고 dist에도 포함되지 않습니다.
제품 앱에는 로그인 성공 토글·개발용 인증 query parameter를 추가하지 않았습니다.

로컬 UI 수동 확인 항목:

1. 비회원 메뉴에서 세트·수량 2를 선택하고 담기 → 로그인 안내 → Escape → 선택·포커스 복귀.
2. 테스트 페이지에서만 세션 주입 후 담기·중복 담기·다른 옵션 담기, 장바구니의 수량/삭제/총액 확인.
3. 새로고침 후 테스트 세션을 다시 주입해 장바구니 복원 확인. 실제 세션은 저장하지 않습니다.
4. 320/390px 모바일과 데스크톱, Tab·Escape·뒤로가기·모달 중첩·빈 상태 확인.

### #110 검증 결과와 남은 연결 (과거 기록)

#145의 최신 Chromium·HTTP 검증 및 줄바꿈에 따른 포맷 검사 결과는
[고객 메뉴 API 연동 기록](docs/customer-menu-api-145.md)에 분리했습니다.

Node 24.22.3/npm 11.19.1에서 npm ci, 자동 테스트, 포맷 검사·프로덕션 빌드를 실행했습니다.
Codex 브라우저 도구는 URL 확인 오류로 실행하지 못했으나, 별도 Work 브라우저 QA와
[수정본 재검증](https://github.com/ktcloud-cloudnative-2026/team02-5xx/issues/110#issuecomment-6971475163)이 기록됐습니다.
Work 보고 기준 320×640/1440×900의 포커스 순환·Escape·선택 유지·스크롤 복원,
장바구니 정상 흐름과 새로고침 복원, fixture 콘솔 오류·경고 0을 확인했습니다.
이는 Codex가 브라우저를 독립 재실행한 결과가 아닙니다. 손상 JSON·스토리지 접근 예외와
일부 확대/대비·장시간 사용 등은 브라우저 미검증이며 자동 검사 범위와 구분합니다.
기존 잠금 의존성에서 npm audit의 high 5건이 보고됐습니다(picomatch 및 Vite 의존 경로).
모두 개발 의존성이고 `npm audit --omit=dev`는 0건입니다. 현재 picomatch 수정 릴리스는 없습니다.
의존성 변경은 수행하지 않았습니다. `audit fix --force`를 실행하지 않았습니다.
패키지별 영향·수정 버전 판단, 브라우저 차단 근거, 실행 명령과 구체적인 금액/포커스/모바일
시나리오 및 완료 조건 대조는 [최종 검증 기록](tests/MANUAL-QA.md)에 정리했습니다.
중첩 상세/로그인 모달의 종료 순서와 관계없이 마지막 모달 종료 시 본문 스크롤을 복원하도록 보완했습니다.
Work QA의 BUG-001은 최상위 모달의 Tab/Shift+Tab 경계만 순환시키도록 수정했습니다.
전역 키보드 리스너는 없으며 내부 이동·열기·닫기는 네이티브 dialog를 유지합니다.
Escape는 최상위 모달 하나만 종료합니다. 자동 포커스 검사는 DOM 모의 객체 기반이며
실제 브라우저 결과는 위 Work 보고를 근거로 합니다.

Issue #156의 Auth Store는 안정된 `subscribe/getSnapshot/getServerSnapshot`을 제공합니다.
기존 테스트용 sessionSource 주입도 유지하며, 고객 동작에는 `authenticated`와 CUSTOMER 역할이 모두 필요합니다.
검증된 로그인 후 대기 동작은 한 번 이어갑니다. 이 내부 UI snapshot은 Gateway의 서버 권한 검증을 대체하지 않습니다.
장바구니 저장 형식은 유지하고 로그아웃 시 삭제하지 않습니다. 같은 탭의 고객 계정이 바뀌면
기존 데이터를 보존한 채 사용을 차단하며, 계정별 소유/이관·새 탭 정책은 후속 계약이 필요합니다.

#145는 병합된 #105 계약에 맞춰 로딩/오류·nullable 필드·PAUSED 상세를 연결했습니다.
계약 Mock HTTP 검증은 통과했으나 실제 Menu Service 프로세스 연동은 미검증입니다.
영양/재료 Mock을 실제 API 필드로 가정하지 않으며 단일 radio 옵션 정책을 유지합니다.
실제 주문 때 Order/Menu/Inventory의 가격·상태·재고 재검증이 필요합니다.
