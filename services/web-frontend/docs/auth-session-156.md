# Issue #156 React Auth 세션 연동과 검증

## 기준과 범위

- 작업 브랜치: `feat/156-web-auth-session`
- 기준 main: `b4724aac6a57df3bb5c891eb0d8e97b73028c0d3`
- [Issue #156](https://github.com/ktcloud-cloudnative-2026/team02-5xx/issues/156),
  [확정 Auth 계약 댓글](https://github.com/ktcloud-cloudnative-2026/team02-5xx/issues/112#issuecomment-7002438953),
  [Auth 구현 Issue #149](https://github.com/ktcloud-cloudnative-2026/team02-5xx/issues/149)을 기준으로 합니다.
- 작업 시작 조회 시 #116은 main에 Squash 병합됐으며 #148·#132는 Open·미병합이었습니다.
  해당 브랜치 코드를 가져오지 않았습니다. 현재 메뉴는 main의 동기 Mock Repository를 사용합니다.
- 인증·보안 변경이므로 제출 시 작성자 외 팀원 필수 리뷰 대상입니다.

## 제출 준비 재점검 (2026-11-23)

- `git fetch origin` 후 원격 main은 `8ee9a5370847499637bcaeea3b817690ca89eb6e`입니다.
  작업 HEAD는 기존 `b4724aa` 그대로이며 main에만 17개 커밋이 있습니다.
  이 추가분에는 web-frontend 파일 변경이 없습니다. 로컬 main 변경·브랜치 전환·통합은 하지 않았습니다.
- [Auth PR #164](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/164)는
  `b5bc639f4f692a56b124545410b1468dd40b5b49`로 병합됐습니다.
  origin/main의 Controller·DTO·Service·쿠키 설정과 클라이언트를 대조했으며,
  AU-01·02·09·10의 경로·Method·요청 본문·200/204·응답 필드·900초는 일치합니다.
  이 대조는 실서버 성공 검증이 아닙니다. 제품 코드·의존성·새 인증 기능은 추가하지 않았습니다.
- #148·#132는 재조회에서도 미병합이며 해당 브랜치 코드를 가져오지 않았습니다.

### 병합된 서버의 실제 동작과 미검증 범위

- Refresh 쿠키 기본 이름은 `peakorderRefreshToken`이며 환경 변수로 설정할 수 있습니다.
  `HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth`이고 Domain을 지정하지 않는 host-only 쿠키입니다.
  rememberMe=false는 서버 만료 1일·브라우저 세션 쿠키, true는 14일·지속 쿠키입니다.
  회전해도 로그인 시 정한 절대 만료를 유지합니다. 클라이언트는 쿠키를 읽거나 이름에 의존하지 않습니다.
- Login·Refresh·Logout은 Origin을 검사하고, Origin이 없으면 Referer를 검사합니다.
  허용 목록과 일치하지 않거나 출처 정보가 없으면 403입니다.
  같은 출처 프록시 설정만으로 허용 목록·HTTPS·쿠키 동작이 검증되지는 않습니다.
- 서버는 회전한 Refresh 재사용을 401로 거부하고 해당 로그인 세션의 활성 Refresh도 폐기합니다.
  현재 클라이언트 single-flight는 **같은 탭 범위**입니다. 탭 간 조정은 미구현이며,
  새 탭 복원·동시 갱신·응답 유실 경합에서 먼저 성공한 탭도 이후 재로그인이 필요할 수 있습니다.
  #112의 다중 탭 UX·조정 방식은 아직 합의가 필요하며 이번에 임의 구현하지 않았습니다.
- 실제 오류는 401 `UNAUTHORIZED`, 403 `FORBIDDEN`, 비활성 세션 API는 503
  `AUTHENTICATION_UNAVAILABLE`입니다. 제안된 세분화 `REFRESH_*` 코드는 구현된 계약이 아닙니다.
- 서버 설정 `AUTH_SESSION_ENABLED` 기본값은 false입니다. main의 dev-session 배포 후보는
  실제 Overlay에 연결되지 않았습니다. #164 병합을 dev 활성화 완료로 표시하지 않습니다.
  [#112의 11월 20일 담당 보고](https://github.com/ktcloud-cloudnative-2026/team02-5xx/issues/112#issuecomment-7031564012)는
  초기 dev 이미지·JWKS 404·동일 HTTPS origin과 설정 준비 필요를 기록합니다.
  이번에는 실제 배포 상태를 직접 조회하지 않았습니다.
- 기존 브라우저 Mock은 `fixtureRefresh; HttpOnly; SameSite=Lax`이며 Secure 속성이 없습니다.
  기존 9개 시나리오는 실제 Secure/Strict 쿠키·출처 검사·CORS/CSRF·Gateway JWT 검증·다중 탭 성공을 증명하지 않습니다.

### 로컬 보존과 이번 검증의 기준

- 과거 106개 bin 파일의 해시 목록은 확보하지 못했으므로 과거와의 동일성은 **미검증**입니다.
  아래 기존 검증 표의 보존·정지 결과는 당시 작업 기록이며 현재 상태를 뜻하지 않습니다.
- 재점검 시 bin은 전체 338개(Auth 27, Cooking 84, Inventory 32, Menu 44, Order 128, Payment 23),
  기존 외부 백업은 4개입니다. 현재 SHA-256·경로·크기·수정 시각을 새 비교 기준으로 기록했습니다.
  기준 위치는 `C:\M\Peak_Order-local-audits\issue156-20261123-084533\before.json`입니다.
  이 기준은 과거 106개와 같다는 근거가 아닙니다. bin·기존 백업은 삭제·복원·덮어쓰지 않습니다.
- 오늘 VS Code의 JDT 재시작·프로젝트 동기화·build jobs 완료 로그와 Gradle 프로세스 재시작을 확인했습니다.
  저장소 workspace 설정에 자동 빌드 해제값이 없고 확장 기본값은 Java 자동 빌드·Gradle 자동 탐지가 켜짐입니다.
  재기동 후 지속될 설정이 없었던 점은 확인했지만 과거 정지 방식과 개별 파일 쓰기 주체는 확정하지 못했습니다.
- 이 저장소의 로컬 `.vscode/settings.json`에 `java.autobuild.enabled=false`,
  `java.configuration.updateBuildConfiguration=disabled`, `gradle.autoDetect=off`를 설정했습니다.
  사용자 전역 설정·기존 프로세스는 변경하지 않았습니다. 언어 서버·daemon의 실행과 자동 빌드 설정은 구분합니다.
  이 파일은 `.git/info/exclude`의 정확한 경로 규칙으로 제출에서 제외했습니다.
  실행 중 서버의 설정 수신 응답은 직접 확인하지 못했으므로 프로세스 정지 완료로 표시하지 않습니다.
  새 기준과 제출 준비 점검 사이 bin 338개·백업 4개의 SHA-256 변경·누락·추가는 0건입니다.
- 이번에는 문서만 보완하므로 기존 Node 98건·브라우저 9개·제품 build를 재실행하지 않습니다.
  기존 실행 결과는 아래 기록과 TEMP 증거를 기준으로 하며 원시 Node 로그·당시 소스 해시 연결은 재확인하지 못했습니다.
  변경 18개 파일 Prettier와 추적·신규 파일 공백 검사를 수행하고 결과는 완료 보고 및 외부 점검 기록에 남깁니다.

## HTTP 계약

| API   | 요청                                                 | 성공 처리                                                  |
| ----- | ---------------------------------------------------- | ---------------------------------------------------------- |
| AU-01 | `POST /api/v1/auth/login`, email/password/rememberMe | 200, 공통 응답의 accessToken/tokenType/expiresIn/user 검증 |
| AU-02 | `GET /api/v1/auth/me`, Bearer                        | 200, id/email/nickname/role 검증                           |
| AU-09 | `POST /api/v1/auth/refresh`, 본문 없음               | 200, AU-01과 같은 토큰 구조                                |
| AU-10 | `POST /api/v1/auth/logout`, 본문 없음                | 204, JSON을 파싱하지 않음                                  |

rememberMe는 기본 false인 JSON boolean입니다. tokenType은 Bearer, expiresIn은 계약의 900초입니다.
토큰을 디코딩해 신뢰하지 않습니다. 로그인·Refresh 후 `/me`의 현재 계정과 일치하는 ID를 확인하고
서버가 반환한 역할을 세션에 반영합니다. 알 수 없는 역할·잘못된 성공 응답은 허용하지 않습니다.
401/403/네트워크 실패를 구분하되 서버 원문·토큰·자격 증명을 사용자 오류 메시지나 로그로 출력하지 않습니다.

Access Token은 Store의 비공개 메모리에만 보관하며 Snapshot에도 넣지 않습니다.
Refresh Cookie는 브라우저가 처리하고 JS에서 읽거나 저장하지 않습니다.
쿠키·URL·임의 헤더·저장소만으로 인증 상태를 승격하지 않습니다.
API 경로는 동일 출처의 `/api/v1/`으로 제한하고 redirect를 거부합니다.

## 세션·경합 처리

- 안정된 외부 Store Snapshot과 구독 해제, 익명 SSR Snapshot을 제공합니다.
- App 최초 접근은 Refresh와 `/me`로 복원합니다. 복원 Promise를 공유해 StrictMode의 반복 호출을 합칩니다.
  한 탭의 동시 Refresh도 하나의 요청으로 합칩니다.
- 로그인은 진행 중인 Refresh 응답이 끝난 뒤 요청합니다. 로그인 제출도 Store와 UI 양쪽에서 중복 차단합니다.
- 로그아웃은 즉시 메모리와 세션을 무효화합니다. 먼저 시작된 로그인·Refresh가 끝난 뒤 Logout을 요청해
  쿠키 회전 응답이 서버 Logout 뒤에 도착하지 않게 합니다. 실패는 화면에 알리고 수동 재시도할 수 있습니다.
- 세대 번호로 늦은 로그인·Refresh·보호 요청 응답의 적용을 막습니다. 모달 취소 시 AbortSignal도 적용합니다.
- 초기 복원 실패나 Refresh 실패 후에는 익명 상태를 유지하고 자동 반복하지 않습니다.
- AU-02와 명시적으로 `retryOn401: true`를 지정한 GET/HEAD만 401 후 Refresh와 최대 한 번 재시도를 허용합니다.
  동시에 만료된 요청은 이미 교체된 토큰을 재사용합니다. POST/PUT/PATCH/DELETE는 자동 재시도하지 않습니다.
  로그인 401·Refresh 401·모든 403은 Refresh 반복을 유발하지 않습니다.
- 15초 전송 제한을 적용합니다. Abort/통신 실패를 성공으로 처리하지 않습니다.

## UI·장바구니 보존

- 로그인 모달에 이메일·비밀번호·로그인 유지, 제출 중 표시, 401/403/통신 오류 안내를 추가했습니다.
  Escape·닫기·Tab/Shift+Tab 순환·중첩 모달 포커스·스크롤 복귀는 기존 dialog 구현을 재사용합니다.
- CUSTOMER만 장바구니/주문 UI를 사용할 수 있습니다. STORE_ADMIN은 고객 권한을 상속하지 않습니다.
  비회원은 메뉴를 조회하고 고객 동작을 시도할 때 로그인합니다. UI 검사는 서버 권한 검증을 대체하지 않습니다.
- 로그인 전 메뉴·옵션·수량·검색·카테고리·정렬을 유지하고 대기 동작 ID별로 한 번만 실행합니다.
- `peak-order.cart.v1`의 version/items/menuId/optionIds/quantity 형식과 기존 계산·검증을 변경하지 않았습니다.
  로그아웃·인증 실패만으로 저장 내용을 삭제하거나 덮어쓰지 않습니다.
- 같은 탭에서 확인한 CUSTOMER ID가 바뀌면 기존 장바구니를 보존한 채 사용을 차단합니다.
  계정별 보관/이관/삭제, 새 탭과 공용 기기 정책은 확정하지 않았습니다.
- 메뉴는 이 기준 main의 Mock 데이터입니다. API 검증 데이터와 연결하는 #148의 비동기 복원 보존 정책을
  이번에 복사하거나 대체하지 않았습니다. 주문/결제 HTTP 호출도 추가하지 않았습니다.

## 로컬 실행과 재현

제품은 같은 출처의 Auth API가 있어야 로그인할 수 있습니다. 서버가 없으면 인증 성공을 만들지 않습니다.
개발 서버에서만 `AUTH_API_TARGET`을 명시하면 `/api/v1/auth` 프록시를 사용할 수 있습니다.
주소는 실제 승인된 서버 주소를 사용해야 하며 `VITE_` 변수로 자격 증명을 노출하면 안 됩니다.
프록시는 Host/Origin·쿠키 속성을 임의 변환하지 않습니다. CORS/CSRF 우회 설정도 추가하지 않습니다.
Vite preview와 운영 배포의 라우팅은 이 개발 프록시 설정의 검증 범위 밖입니다.

```powershell
npm.cmd test
npm.cmd run build
# 이미 설치된 외부 Playwright와 Chromium 경로를 지정합니다. 저장소 의존성 추가 없음.
$env:PLAYWRIGHT_PACKAGE = '<기존 Playwright 패키지 절대 경로>'
$env:PLAYWRIGHT_BROWSERS_PATH = '<기존 Chromium 캐시 경로>'
node tests/auth-browser.mjs
```

`tests/auth-http-fixture.mjs`는 loopback의 계약 Mock HTTP 서버이며 실제 Auth 서버가 아닙니다.
서버가 시험 사용자와 임시 토큰을 검증하고 시험용 HttpOnly Cookie를 발급합니다.
쿠키 속성은 loopback 테스트 설정이며 실제 배포 계약이 아닙니다. 제어 API·가짜 로그인은 제품에 추가하지 않았습니다.
기존 주입 세션 fixture도 tests 아래에서만 유지하며, 제품 번들에 포함하지 않습니다.
브라우저 fixture는 메모리에서 정적 빌드하고 종료 후 서버/브라우저를 닫습니다.
StrictMode 래퍼의 실제 화면과 Store 반복 복원 검사를 구분합니다.
정적 production React fixture는 개발 모드의 effect 이중 실행을 재현하지 않으며 반복 호출은 단위 테스트로 검증합니다.
네트워크에 토큰이 들어가는 trace/HAR는 저장하지 않고, 비밀번호를 지운 화면과 결과만 외부 TEMP에 보관합니다.

## 기존 검증 결과 (2026-11-19 작업 기록)

Node 24.22.3 / npm 11.19.1에서 실행했습니다.

| 검사                                              | 결과                                        |
| ------------------------------------------------- | ------------------------------------------- |
| `npm.cmd test`                                    | 98건 통과, 실패·생략 0                      |
| `npm.cmd run build`                               | 성공, 제품 번들 경계 자동 검사도 통과       |
| 변경 18개 파일 Prettier                           | 통과                                        |
| 전체 기본 `format:check`                          | 미수정 기존 17개 파일의 CRLF로 실패         |
| 전체 `--end-of-line auto` 검사                    | 통과, 기존 CRLF 파일은 수정하지 않음        |
| `git diff --check`                                | 통과                                        |
| 실제 Windows Playwright Chromium + 계약 Mock HTTP | 9개 시나리오 통과                           |
| 기존 bin 106개 + 외부 백업 4개                    | 시작·종료 SHA-256 일치, 누락·추가 변경 없음 |
| JDT·Gradle 보호                                   | 정지 상태 유지, Java/Gradle 빌드 미실행     |

Chromium은 1440×1000 및 390×844 화면에서 실제 React 페이지를 렌더링했습니다.
최초 복원, 선택·검색·카테고리·정렬 보존, 세트 수량 2의 18,000원과 저장 형식,
401 안내와 중복 제출 차단, STORE_ADMIN 고객 기능 거부, HttpOnly 복원과 AU-02,
204 Logout 후 저장 보존, 중첩 모달 Tab/Shift+Tab/Escape·포커스·스크롤,
닫은 로그인 응답 무시, 네트워크/403 수동 재시도, 모바일 Logout 실패·재시도를 확인했습니다.
페이지 예외 및 Auth 이외의 실패 HTTP 응답은 0건입니다. 401·403·503·통신 중단은 의도한 실패 주입입니다.
동시 Refresh/Logout 경합과 안전 요청 재시도는 Node 테스트에서 별도로 검증했습니다.

실제 증거 폴더: `C:\Users\reki0\AppData\Local\Temp\peak156-auth-1795077861007`
(`results.json`, `gallery.html`, `1.png`~`9.png`). TEMP 자료는 Git에 포함하지 않습니다.
검증 대상은 위 기준 main 위의 미커밋 작업 트리이며 새 커밋 SHA는 없습니다.

실제 Auth Service, Gateway/배포 Proxy, 실사용 Refresh Cookie, CORS/CSRF 연동은 **미검증**입니다.

## 제출 전 변경 범위

`services/web-frontend/` 아래 기존 수정 10개·신규 8개, 총 18개 파일입니다.
package.json·lockfile·백엔드·관리자 Mock UI는 변경하지 않았습니다. Staging은 비어 있고 Commit·Push·PR 생성은 하지 않았습니다.

| 구분                            | 파일                                                                                                                                                |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 클라이언트·Store (신규)         | `src/authApi.js`, `src/authSession.js`                                                                                                              |
| 고객 UI·역할·개발 프록시 (수정) | `src/App.jsx`, `src/components/LoginModal.jsx`, `src/session.js`, `src/index.css`, `vite.config.js`                                                 |
| 신규 검증                       | `tests/authSession.test.js`, `tests/auth-boundary.test.js`, `tests/auth-browser-entry.jsx`, `tests/auth-http-fixture.mjs`, `tests/auth-browser.mjs` |
| 기존 검증 보완                  | `tests/session.test.js`, `tests/ui.test.js`, `tests/browser-fixture-entry.jsx`, `tests/ui-fixture.mjs`                                              |
| 문서                            | `README.md` (수정), `docs/auth-session-156.md` (신규)                                                                                               |

## 미확정 계약과 선행 PR 결합

- #164의 실제 쿠키·Origin 동작은 위 재점검 절을 따릅니다. 환경별 HTTPS/Origin·CORS/CSRF 전달,
  Gateway A/B 신뢰 경계·JWT/신원 전달·Gateway 401 및 오류 세분화의 공통 합의와 실환경 검증은 남아 있습니다.
  현재 일반 401의 재시도 정책보다 엄격한 errorCode 규칙이 확정되면 어댑터에서 제한해야 합니다.
- 서버의 재사용 시 현재 세션 폐기는 #164에 구현됐습니다. 탭 간 조정·UX 합의는 미완료이며,
  현재 single-flight는 한 탭 범위입니다. 임의 탭 간 토큰 저장을 추가하지 않았습니다.
- 로그인 모달 취소는 JS 적용을 막습니다. 이미 서버가 발급한 쿠키의 철회를 보장하는 정책은 별도입니다.
  클라이언트 Logout 실패 역시 서버 쿠키 폐기를 보장하지 않으며 사용자에게 실패와 재시도를 표시합니다.
- #148과 `App.jsx`, session 주입 테스트, README, Vite 프록시 설정이 겹칠 수 있습니다.
  결합 시 #148의 비동기 메뉴 로딩/오래된 응답 방지/검증 전 cart 보존을 유지하고 Auth Store를 연결해야 합니다.
  공개 ME-01·02에 불필요한 인증 강제나 쓰기 재시도를 넣지 않아야 합니다.
- #132는 관리자 Mock 미리보기와 스타일·README·테스트 설정이 겹칠 수 있습니다.
  관리자 Mock을 실제 인증으로 승격하거나 제품 관리자 라우트를 개방하지 않아야 합니다.
- 실제 주문·결제, 관리자 HTTP 인증, 보안 외부 리뷰와 실서버 통합은 이 작업의 완료로 간주하지 않습니다.
