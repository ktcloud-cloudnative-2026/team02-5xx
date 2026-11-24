# 고객 마이페이지 — Issue #260

- 브랜치 `feat/260-customer-account`, 시작점 `origin/main`의 `eac2e88`.
- #257 커밋 `1b10e55`와 기존 미추적 `inventory/order/payment-service/bin/` 보존. #258 코드는 가져오지 않았다.
- Auth PR #221의 AU-02·05·06 및 `docs/api/auth-profile-password-proposal.md`, Auth README, API 화면 기획을 기준으로 구현했다. 설계 문서의 병합 전 상태 문구와 달리 #221은 GitHub에서 병합 완료임을 확인했다.
- Auth 백엔드·스키마·라이브러리·인프라 변경 없음. 인증·보안 변경이므로 PR은 작성자 외 팀원 필수 리뷰 대상이다. 사용자가 화면 검수를 완료하고 Commit·Push·PR 생성 및 Auth 담당 `lth1202` 리뷰 요청을 승인했다. PR 병합은 승인하지 않았다.

## 화면과 계약

`#account`, `#account/profile`, `#account/password`를 기존 고객 탐색에 추가했다. 비회원은 로그인 안내, STORE_ADMIN은 접근 차단한다. AU-02 조회의 로딩·실패·수동 재조회, nickname=null 회원을 지원한다.

AU-05는 `{nickname}`만 PATCH하고 200 회원정보로 로그인 표시·마이페이지를 동기화한다. 1~50 Unicode 코드 포인트, 공백만인 입력 거부, 원문 공백 보존을 적용한다. 이메일·ID·역할은 변경하지 않는다.

AU-06은 `{currentPassword,newPassword}`만 PATCH한다. 새 비밀번호는 현재 개발 기본 정책 12~64 코드 포인트이며 확인은 화면에서만 검사한다. 원문을 trim하지 않는다. 204에서 JSON 파싱·추가 logout 없이 Access 메모리·인증 스냅샷·이전 세션 요청을 무효화한다. 메뉴·장바구니 데이터는 보존한다. 모든 기기의 Refresh 폐기와 기존 Access 잔여 유효시간을 구분해 안내한다.

중복 제출을 세션·화면 양쪽에서 차단하고 변경 요청은 자동 재전송하지 않는다. 화면을 떠난 프로필 요청은 취소하고 abort를 무시하는 응답도 적용하지 않는다. 이미 전송한 비밀번호 변경은 화면을 떠나도 204를 받으면 로컬 인증을 종료한다. 이전 GET·Refresh가 새 닉네임이나 종료된 인증을 덮어쓰지 못한다. 400 코드별 입력 오류, 401 재로그인, 403 권한, 서버·네트워크 오류를 구분한다.

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
