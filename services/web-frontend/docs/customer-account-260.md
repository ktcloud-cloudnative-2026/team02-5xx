# 고객 마이페이지 — Issue #260

- 브랜치 `feat/260-customer-account`, 시작점 `origin/main`의 `eac2e88`.
- #257 커밋 `1b10e55`와 기존 미추적 `inventory/order/payment-service/bin/` 보존. #258 코드는 가져오지 않았다.
- Auth PR #221의 AU-02·05·06 및 `docs/api/auth-profile-password-proposal.md`, Auth README, API 화면 기획을 기준으로 구현했다. 설계 문서의 병합 전 상태 문구와 달리 #221은 GitHub에서 병합 완료임을 확인했다.
- Auth 백엔드·스키마·라이브러리·인프라 변경 없음. 인증·보안 변경이므로 PR은 작성자 외 팀원 필수 리뷰 대상이다. 사용자가 화면 검수를 완료하고 Commit·Push·PR 생성 및 Auth 담당 `lth1202` 리뷰 요청을 승인했다. PR 병합은 승인하지 않았다.

## 화면과 계약

`#account`, `#account/profile`, `#account/password`를 기존 고객 탐색에 추가했다. 비회원은 로그인 안내, STORE_ADMIN은 접근 차단한다. AU-02 조회의 로딩·실패·수동 재조회, nickname=null 회원을 지원한다.

AU-05는 `{nickname}`만 PATCH하고 200 회원정보로 로그인 표시·마이페이지를 동기화한다. 1~50 Unicode 코드 포인트, 공백만인 입력 거부, 원문 공백 보존을 적용한다. 이메일·ID·역할은 변경하지 않는다.

AU-06은 `{currentPassword,newPassword}`만 PATCH한다. 새 비밀번호는 현재 개발 기본 정책 12~64 코드 포인트이며 확인은 화면에서만 검사한다. 원문을 trim하지 않는다. 204에서 JSON 파싱·추가 logout 없이 Access 메모리·인증 스냅샷·이전 세션 요청을 무효화한다. 메뉴·장바구니 데이터는 보존한다. 모든 기기의 Refresh 폐기와 기존 Access 잔여 유효시간을 구분해 안내한다.

중복 제출을 세션·화면 양쪽에서 차단하고 변경 요청은 자동 재전송하지 않는다. 화면을 떠난 프로필 요청은 취소하고 abort를 무시하는 응답도 적용하지 않는다. 이미 전송한 비밀번호 변경은 화면을 떠나도 204를 받으면 로컬 인증을 종료한다. 이전 GET·Refresh가 새 닉네임이나 종료된 인증을 덮어쓰지 못한다. 400 코드별 입력 오류, 401 복구·재로그인, 403 권한, 서버·네트워크 오류를 구분한다.

## PR #262 Auth 401 후속 보완 (로컬 검증)

- 작업 시작 시 #298 `fb39138`, #299 `72d7d5b` 브랜치와 재고 미리보기 5284(PID 1868)를 확인했다. 이 두 ref·프로세스는 변경하지 않았다. 기존 서비스 bin 미추적 파일과 다른 worktree도 보존했다.
- 로컬 #260을 원격 PR HEAD `df7abb5`까지 fast-forward했다. 최신 `origin/main` **316a404**를 `merge --no-commit --no-ff`로 통합했으며 **충돌 없음**. #258 회원가입과 #132 관리자 메뉴를 보존했다. main에 없는 #298/#299 코드는 가져오지 않았다. Commit 금지에 따라 HEAD는 그대로이며 merge 결과는 index, 이번 수정은 working tree/신규 테스트에 남겨 두었다. Push·PR 갱신도 하지 않았다.
- 변경 전: AU-05·06은 `authorized(operation, false)`의 401에서 즉시 `clear('expired')`를 실행했다. 폼 finally는 성공 여부와 무관하게 비밀번호 세 필드를 지웠다.
- 변경 후: 계정 변경 요청만 별도 401 복구 경로를 사용한다. 같은 탭의 진행 중 Refresh를 공유하고, 이미 완료된 회전은 인증 revision으로 감지한다. Access 문자열이 같아도 회전 완료를 다시 Refresh하지 않는다. Refresh/AU-02 검증 성공 시 Access·인증 상태를 갱신하지만 **원래 PATCH는 재전송하지 않고** `AuthError.kind = 'account-retry'`를 반환한다.
- 폼은 해당 오류에서만 현재·새·확인 비밀번호를 유지하며 닉네임 초안도 유지한다. 안내는 **"인증이 갱신되었어요. 입력한 내용을 확인하고 다시 저장해 주세요."**다. 사용자 저장 버튼이 다음 PATCH를 새 Access로 한 번 보낸다. 일반 입력/서버 오류의 기존 비밀번호 정리 동작과 204 성공 후 재로그인 흐름은 유지한다.
- Refresh 전후 현재 사용자 ID와 CUSTOMER 역할, Refresh user·AU-02 user ID/역할을 확인하고 **스냅샷 공개 전에** 불일치를 거절한다. Refresh 401뿐 아니라 503·네트워크 실패도 기존 Refresh 실패 정책과 동일하게 로컬 인증을 종료한다. 이 경우 폼이 해제되므로 이전 비밀번호는 재로그인 후 복원하지 않는다.
- 변경 요청 400·403·503·네트워크 실패에는 Refresh를 호출하지 않는다. 기존 GET 재시도와 일반 `session.request`의 인증 정책은 수정하지 않았다.
- 계정 변경 때문에 시작한 Refresh는 취소 후 성공/실패 모두 늦은 Access·화면·안내를 적용하지 않는다. 다른 GET/명시적 Refresh가 이미 소유하거나 공유한 회전은 그 독립 요청의 기존 수명을 유지하며, 취소된 계정 요청만 cancelled로 처리한다. 어느 경우에도 PATCH 재전송·옛 폼 복원은 없다. 로그아웃·계정 전환은 기존 generation으로 무효화한다.
- AU-06은 UI 취소 signal을 복구 경로에 전달하지만 이미 보낸 PATCH 자체는 abort하지 않는다. 따라서 늦게 204가 와도 같은 세대의 로컬 인증을 폐기한다. 추가 `/logout`은 호출하지 않고 모든 기기 Refresh 폐기·기존 Access 잔여 유효시간 안내와 메뉴·장바구니 보존을 유지한다.
- 입력은 React 폼의 메모리에만 보존한다. 비밀번호를 localStorage/sessionStorage·스냅샷·로그로 저장하지 않는다. HTTP fixture의 요청 기록도 path/method와 합성 토큰의 숫자 발급 순번만 기록한다.

이번 보완 파일은 `src/authSession.js`, `src/account/AccountPage.jsx`, `src/account/accountValidation.js`, `tests/account.test.js`, `tests/account-fixture.mjs`, `tests/account-browser.mjs`, 신규 `tests/account-recovery.test.js`, `tests/account-recovery-browser.mjs` 및 이 문서다. Auth 백엔드·API 계약·라이브러리는 변경하지 않았다. staged에 보이는 다른 main 파일은 기존 main merge 결과다.

검증 로그는 저장소 밖 `C:/M/Peak_Order-account-401-qa/`에 둔다. 전체 Node **399 PASS**. 새 복구 Chromium **14 PASS**는 AU-05/06 401 성공·입력 유지, 실패 401/503/network 후 재로그인, 명시적 새 Access 재제출, 자동 PATCH 없음, 중복 제출, 취소·로그아웃·CUSTOMER 제한, 204/no logout과 저장소 보존을 포함한다. 기존 마이페이지 Chromium(1440·390·320)도 통과했다. 회원가입 **13 PASS**, 기존 고객 **79 PASS**(Auth 9/HTTP Checkout 23/장바구니 16/주문 내역 16/홈 15), Build·변경 파일 Prettier·전체 `--end-of-line auto`·working/index/신규 파일 diff 검사도 통과했다. 실제 Auth/Gateway E2E는 이 HTTP fixture 결과와 구분하며 여전히 미검증이다.

## 로컬 화면 검수

```powershell
cd C:\M\Peak_Order\services\web-frontend
npm.cmd run test:account:ui
```

Vite 제품 React 화면은 `http://127.0.0.1:5260/#account`에서 제공한다. 이 실행 모드는 Auth·Menu·Order를 **로컬 HTTP fixture**로 프록시하며 실제 Auth 서버에 연결하지 않는다. 주문 내역은 빈 목록으로 제공하며 결제 검수용 fixture는 아니다.

가상 계정은 `customer@example.test` / `fixture-only-password`다. 수정·변경은 프로세스 메모리에만 남는다. 비밀번호 변경 후에는 직접 입력한 새 비밀번호로 로그인한다. 초기화는 해당 미리보기 프로세스만 다시 실행한다. 관리자 차단 확인용 이메일은 `admin@example.test`다. 데스크톱과 브라우저 모바일 모드(390px·320px)에서 같은 주소를 사용할 수 있다.

마이페이지 → 회원정보 수정 → 저장 → 메뉴 로그인 사용자 표시 확인 → 비밀번호 변경 → 재로그인 안내 → 새 비밀번호로 로그인을 확인한다. 메뉴·주문 내역 링크와 브라우저 뒤로가기도 확인한다.

## 자동 검증과 실제 Auth 환경의 구분

```powershell
npm.cmd test
npm.cmd run build
npm.cmd run format:check
git diff --check
$env:PLAYWRIGHT_PACKAGE = '<외부에 이미 설치된 Playwright 패키지 경로>'
$env:ACCOUNT_QA_OUTPUT = '<저장소 밖 스크린샷 출력 폴더>'
node tests/account-browser.mjs
```

추가로 기존 `auth-browser.mjs`, `customer-http-browser.mjs`, `guest-cart-browser.mjs`, `order-history-browser.mjs`를 실행해 기존 로그인·메뉴·장바구니·주문 흐름을 검증한다. #258 회원가입은 미병합이므로 이번 main 기준 실행·검증에 포함하지 않는다.

2026-11-24 검증 결과: Node 217개(신규 19개), 마이페이지 Chromium 및 기존 4개 Chromium 회귀 스위트, production build, 변경 파일 Prettier, diff 검사를 통과했다. 전체 기본 Prettier 검사는 기존 미변경 79개 파일의 Windows CRLF 때문에 실패하며 `npm.cmd run format:check -- --end-of-line auto`는 전체 통과했다. 무관한 파일의 줄바꿈은 변경하지 않았다. 스크린샷과 결과 로그는 저장소 밖 `C:\M\Peak_Order-account-260-qa`에 저장했다.

실제 서버 연결은 별도 터미널에서 기존 Vite 설정의 `AUTH_API_TARGET` 또는 `GATEWAY_API_TARGET`을 승인된 개발 서버 주소로 설정하고 `npm.cmd run dev -- --host 127.0.0.1 --port 5261 --strictPort`로 실행한다. 실제 주소·계정은 저장소에 기록하지 않는다. 5260은 항상 fixture 전용이다.

실제 서버 E2E는 아직 수행하지 않았다. 배포된 AU-05·06, 설정된 비밀번호 길이, Gateway Origin 허용·Secure Refresh 쿠키·HTTPS·CORS/CSRF 환경, 여러 기기의 Refresh 폐기, 변경 후 재로그인은 실제 개발 서버와 승인된 테스트 계정으로 확인해야 한다. 로컬 HTTP fixture 통과는 이 검증을 대신하지 않는다.
