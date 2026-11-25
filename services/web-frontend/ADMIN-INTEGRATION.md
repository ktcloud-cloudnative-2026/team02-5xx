# 관리자 공통 앱 (#304)

기준 main: `4f1b43778a78c0a230c46711366f07c8ac28017a`.
작업 브랜치: `feat/304-admin-layout-routing`.
#319 / PR #331은 미병합이므로 소스를 통합하지 않았다. 사용자가 확정한 A안 로고 원본 이미지 파일만 그대로 재사용했다.

## 제품 경로와 구조

| 경로               | 기존 화면                             |
| ------------------ | ------------------------------------- |
| `#admin`           | #306 대시보드                         |
| `#admin/menus`     | #132 메뉴 관리 + ME-03~07 HTTP 어댑터 |
| `#admin/orders`    | #279 주문 관리 / OR-08·09             |
| `#admin/inventory` | #299 재고 관리 / IN-02~06             |
| `#admin/cooking`   | #311 조리 조회 / CO-01·03·04          |

`Application`이 공통 AuthSession 복원을 완료한 뒤 인증 역할과 hash namespace를 함께 판단해 고객 App 또는 관리자 App 하나만 지연 로드한다.
기존 고객 경로와 고객 App 코드는 변경하지 않는다.
`AdminLayout`은 공통 로고·탐색·계정·로그아웃·본문 건너뛰기와 모바일 탐색을 제공한다. 고객 화면 전환 링크와 관리자 전용 로그인 UI는 제공하지 않는다.
기존 화면은 `embedded` 모드에서 자체 사이드바와 main을 중복 렌더링하지 않는다.
각 화면의 독립 검수 진입점은 유지한다.
주문 검색·상세 query와 History는 통합 경로에서도 기존 동작을 유지한다.
페이지 전환은 화면을 unmount해 모달·polling·요청을 정리하고 새 제목에 포커스와 스크롤을 이동한다.
메뉴 조회는 AbortSignal과 응답 세대 검사를 함께 사용한다.

## 인증과 API 경계

기존 AuthSession으로 복원·로그인·로그아웃하고 STORE_ADMIN을 확인한 뒤에만 본문과 요청을 시작한다.
사용자 ID가 바뀌면 보호 화면을 새로 생성하고 이전 사용자 응답을 거부한다.
GET/HEAD만 기존 세션의 401 재발급을 사용할 수 있고 POST/PATCH/DELETE는 자동 재전송하지 않는다.
403은 권한 오류로 남긴다. 신원 헤더를 생성하지 않는다.
제품 메뉴 등록·수정·상태 변경은 HTTP 응답을 확인한 후에만 성공을 알린다.
네트워크·5xx·잘못된 성공 응답으로 저장 결과가 불명하면 같은 창의 재제출을 막고 목록 재조회를 안내한다.

Menu 계약 근거: `docs/api/menu-me03-me04-draft.md`, `menu-me05-draft.md`, `menu-me06-draft.md`,
`menu-me07-draft.md`, `menu-admin-auth-integration.md` 및 main의 Controller/DTO.
기존 문서의 Draft 이력과 현재 기본 차단 상태를 구분한다.
서버의 관리자 접근 기본 차단 정책은 변경하지 않는다. 실제 활성화와 Gateway 검증은 #280 범위다.

## 로컬 통합 검수

```powershell
cd C:\M\Peak_Order\services\web-frontend
$env:PORT = '5306'
npm.cmd run preview:admin-integration
```

현재 추가 역할 통합 검수 URL: `http://127.0.0.1:5306/#home`. 기존 5304·5305 서버는 보존한다. 스크립트의 기본 포트는 5304이며 위 명령처럼 PORT로 별도 지정한다.
포트가 사용 중이면 기존 서버를 종료하지 않고 `$env:PORT`로 다른 포트를 지정한다.
이 주소는 loopback 전용 HTTP fixture이며 실제 Gateway·dev/prod API와 연결하지 않는다.
제품 App과 실제 HTTP 어댑터를 그대로 사용하고 서버 쪽에서 기존 화면별 검수 데이터를 합성한다.
제품이 실제 API 오류를 Mock 성공으로 대체하는 동작은 없다.

기본 **공통 홈** 시나리오는 비회원으로 시작한다. 고객 화면의 기존 로그인 모달 하나로 CUSTOMER와 STORE_ADMIN을 모두 인증한다. **정상 관리자** 시나리오는 기존 검수용 관리자 세션 자동 복원을 유지한다.
수동 로그인 계정: `admin@example.test`, `customer@example.test`.
검수 전용 비밀번호: `fixture-only-password`.
화면 하단의 **통합 시나리오**에서 정상·비회원·CUSTOMER·만료·GET 재발급·403·404·503·빈 데이터·지연·변경 결과 불명을 선택한다.
변경 시 fixture 데이터와 인증을 초기화하고 현재 경로를 새로고침한다.
CUSTOMER는 고객 앱에 머물고 관리자 경로는 #home으로 replace한다. STORE_ADMIN은 고객 경로를 #admin으로 replace하며 고객 App을 마운트하지 않는다. 인증 복원 중에는 어느 앱도 마운트하지 않는다. 알려지지 않은 역할은 보호 화면을 제공하지 않는다. 로그인·로그아웃·계정 전환은 같은 AuthSession을 사용한다. 고객 로그인은 기존 선택과 주문 의도를 유지하고 관리자 로그인 및 이전 계정 종료는 고객 주문 의도를 폐기한다. 장바구니의 브라우저 저장 정책은 그대로다. 다른 포트의 검수 세션을 덮어쓰지 않도록 fixture 쿠키 이름은 서버별로 분리한다.
1440px·390px·320px에서 확인한다.

## 검증 명령

```powershell
npm.cmd test
# 설치된 Playwright 패키지 경로를 지정한 로컬 Chromium 검증
$env:PLAYWRIGHT_PACKAGE = '<Playwright package path>'
npm.cmd run test:admin-integration:ui
npm.cmd run test:application-roles:ui
npm.cmd run build
npm.cmd run check:admin-boundary
git diff --check
```

`check:admin-boundary`는 실제 제품 빌드 모듈 그래프에 tests/preview/Mock 어댑터/샘플 데이터가 포함되지 않는지 검사한다.
fixture 계정·토큰·제어 endpoint가 dist에 없는지도 검사한다.
실제 dev API·관리자 접근 활성화·서비스 간 E2E는 이 로컬 검증의 대상이 아니다.
기존 Windows checkout의 CRLF에 의한 Prettier 실패는 변경 파일의 포맷 검사와 구분해 보고한다.

## 최종 실행 결과 (역할 분리 추가 포함)

- 전체 Node: **697/697 PASS**.
- 역할 통합 Chromium: **53/53 PASS**. 공통 폼으로 두 역할 로그인, 계정 전환,
  직접 URL·History 교정, 세션 복원·Refresh 성공/실패, 모달 선택·장바구니 보존,
  관리자 로그인 시 고객 주문 의도 폐기, 이전 요청 격리, 지원하지 않는 역할,
  코드 로딩 중 고객 트리 제거, 미리보기 쿠키 격리, 1440·390·320px를 포함한다.
- 통합 관리자 Chromium: **55/55 PASS**. 기존 55개 시나리오를 유지하며
  잘못된 역할 접근과 로그아웃의 기대 동작을 새 공통 홈 정책으로 검증한다.
- 기존 관리자 Chromium: 주문 **10**, 재고 **27**, 대시보드 **22**, 조리 **21** PASS.
- 고객 Chromium: HTTP 통합 **23**, 홈 **15**, 주문 내역 **16**, 인증 **9** PASS.
- Chromium 합계: **251/251 PASS**. 모두 로컬 HTTP fixture 대상이며 실제 dev E2E가 아니다.
- Vite build, 제품 번들 경계, 변경 텍스트 33개 Prettier, `git diff --check`: PASS.
- 전체 파일의 기존 CRLF 포맷 문제는 변경하지 않았다.
- 실제 실행 중인 **5306**에서 HTTP 200, 공통 로그인 → CUSTOMER → 관리자 URL 차단 → 로그아웃 →
  STORE_ADMIN → 5개 관리자 화면 → 고객 URL 차단 → 로그아웃/공통 홈 복귀를 확인했다.
  CUSTOMER의 관리자 API 호출 0건, STORE_ADMIN의 고객 주문 API 호출 0건, pageerror 0.
- 기존 5304·5305 서버와 다른 worktree·미추적 파일을 보존했다.
- 실제 dev E2E·Gateway·관리자 API 활성화·배포는 수행하지 않았다.
- 위 구현 검증 시점에는 Commit·Push·PR·Merge를 수행하지 않았다. 사용자 최종 승인 후에는 아래 제출 준비 기록에 따라 #304 Commit만 진행한다.

## 역할 분리 추가 구현 및 원격 상태

- 기존 URL만의 최상위 분기를 `applicationRoute` 역할 정책으로 보완했다. 잘못된 역할 경로는 push 없이 replace해 History 루프를 막는다.
- `Application`은 인증 복원·공통 로그인/로그아웃을 소유하며 같은 세션을 두 App에 전달한다. 별도 관리자 로그인 페이지/API/버튼은 없다.
- 게스트→CUSTOMER 로그인은 고객 App 인스턴스를 보존한다. 인증된 사용자 이탈/변경 시 보호 UI 인스턴스를 새로 만들고 기존 요청·polling·모달을 정리한다. 고객→관리자 변경 때는 Suspense 경계도 교체해 로딩 중 숨겨진 고객 트리를 남기지 않는다.
- `App.jsx`, Auth API/Session, Checkout 업무 처리와 개별 관리자 화면의 디자인은 추가 작업에서 변경하지 않았다.
- 원격 조회 main은 `f81893b1ce40d4f68f52001ee9070b16fdfe5c62`로 진행됐으며 #267이 병합됐다. 현재 작업 기준 `4f1b437`은 유지한다. #267의 App·fixture 수정 및 배포 태그를 미커밋 작업에 임의 merge/rebase하지 않았다. PR 제출 전 별도 통합 검토가 필요하다.
- 당시 #319 PR #331은 미병합·충돌 상태였으며 이 작업에 소스를 가져오지 않았다. 최신 상태는 아래 제출 준비 기록을 따른다.
- 인증 경계 변경이므로 추후 PR 제출 시 작성자 외 팀원 필수 리뷰 대상이다. 실제 관리자 공개 활성화/#280·dev E2E는 별도다.

## Gateway text/plain 인증 오류 확인 및 #331 병합 후 통합 검증

- #303으로 `/api/v1/orders`에 JSON이 아닌 text/plain 401이 올 수 있다. 고객 Checkout의 해당 보완은 미병합 #331 소유이며 이번 #304에서 복사·중복 구현하지 않았다. 고객 `App.jsx`, Checkout 어댑터 및 Auth API/Session 제품 코드는 변경하지 않았다.
- 관리자 메뉴·조리는 이미 HTTP 상태를 본문보다 먼저 판단한다. 주문·재고·대시보드는 JSON 읽기 실패 뒤에도 상태를 보존했지만, 이번에 401/403을 JSON 읽기 전에 명시적으로 거부하도록 보완했다. 계약상 UNAUTHORIZED/FORBIDDEN 오류 코드와 나머지 업무 오류 JSON 처리는 유지한다.
- 관리자 5종의 text/plain/JSON 401/403에서 JSON reader 호출 0회, 변경 요청 POST/PATCH/PUT/DELETE에서 자동 재전송 0회를 Node 회귀로 검증했다.
- AuthSession의 GET Refresh single-flight와 최대 1회 재시도, 재시도 후 401 종료, 403 세션 유지, 변경 요청 재전송 금지 정책은 기존 구현을 그대로 사용한다. 관련 AuthSession Node 회귀와 실제 Chromium에서 plain 401 성공/실패/반복, plain 403의 5개 관리자 화면, POST 401 및 PATCH 403을 확인했다.
- Refresh 실패·재시도 후 401에서는 보호 트리를 제거하고 #home으로 복귀한다. 잘못된 역할 경로는 CUSTOMER/비회원 #home, STORE_ADMIN #admin으로 replace한다.
- **#331 병합 이후 최신 main 통합 시 실행할 회귀:** 고객 Checkout의 plain/JSON 401·403, GET Refresh 성공·실패·최대 1회 재시도, 주문 생성/결제 POST 중복 금지, 결제 결과 불명/장바구니 보존, 로그인 후 기존 선택·주문 재개, 계정 전환 격리, 관리자 5종 401·403/만료/로그아웃/역할 경계, 제품 번들 분리. 이 후속 통합 검증은 아직 수행하지 않았다.
- Gateway·백엔드 기본 차단·Kubernetes·배포 정책은 변경하지 않았다. 로컬 fixture 검증은 실제 Gateway/dev E2E 성공을 의미하지 않는다.

## 사용자 최종 승인 후 Commit 제출 준비

- 사용자가 현재 구현·디자인의 최종 검수를 완료했다. 추가 기능·디자인 변경 없이 `feat(web): integrate admin layout and role-based routing (#304)` Commit만 승인했다. Push·PR 생성·실제 merge는 이번 범위에 없다.
- 작업 브랜치 `feat/304-admin-layout-routing`, 기준 HEAD/main `4f1b43778a78c0a230c46711366f07c8ac28017a`를 유지한다. 제출 전 fetch한 origin/main은 `4ffb039366a048af3315ac48187c24096e9037bb`이며 기준보다 6개 커밋 앞선다.
- 최신 main에는 #267 고객 재고 연동 외에 Auth 운영 설정·Order/Cooking HPA·Inventory 관리자 dev 공개 #337이 추가됐다. 이 작업에서 해당 코드를 merge/rebase하거나 배포·Gateway·백엔드 정책을 변경하지 않았다. #337 병합 자체를 이 프론트엔드의 실제 Gateway E2E 검증으로 간주하지 않는다.
- **#267/main 통합 영향:** 동시 변경은 `package.json`, `tests/ui-fixture.mjs` 2개다. 별도 임시 파일의 3-way 텍스트 검사에서 두 파일 모두 충돌 0건이었다. 고객 App·장바구니·재고 표시의 main 변경을 덮어쓰지 않고 통합한 뒤 고객 재고/장바구니·역할 경계 회귀를 수행해야 한다. 실제 main 통합은 아직 하지 않았다.
- **#331 통합 영향:** 원격 HEAD `0bc2dc77f3e332d585dfc0ef9b744304e9f9329c`, Open·MERGEABLE이며 미병합이다. 제출 전 조회에서는 React service CI 및 CI Final이 FAILURE이고 리뷰어 요청은 없다. 이 상태를 수정하거나 해당 브랜치에 작업하지 않았다.
- #331과의 동시 변경도 `package.json`, `tests/ui-fixture.mjs`는 3-way 텍스트 충돌 0건이고 확정 로고 add/add는 동일한 바이트다. 소스 복사·cherry-pick·임의 통합은 하지 않았다. 이 검사는 의미상 통합·CI 성공을 보장하지 않는다.
- #331의 고객 사이드바, 장바구니·닉네임·이미지·UX 및 Checkout 비 JSON 401/403 개선은 향후 병합된 main 통합 시 보존한다. 이 작업에서 중복 구현하지 않았다. 앞 절의 고객·관리자 인증 회귀, 재고 연동, 번들 경계 검증을 통합 후 다시 실행한다.
- 마지막 구현 검증 이후 코드 파일의 추가 변경은 없음을 파일 수정 시각과 동일한 제품 빌드 산출물 이름으로 확인했다. 제출 준비에서는 문서 기록만 갱신하고 Node·Build·번들 경계·변경 파일 Prettier·diff 검사를 다시 수행한다. Chromium 251 PASS는 기존 직접 실행 기록이며 이번 제출 준비에서 재실행한 결과로 표시하지 않는다.
- 실제 dev Gateway E2E는 미검증이다. 인증 경계 변경의 필수 외부 리뷰는 추후 PR 단계에서 요청해야 한다.
