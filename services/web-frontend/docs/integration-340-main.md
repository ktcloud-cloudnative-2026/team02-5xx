# #340 최신 main 통합 검증

기준: 작업 브랜치 `feat/304-admin-layout-routing`, 기존 HEAD `9e3b9c6229819fb24bf7bffcaf84ca93dee3adec`.
통합 대상은 fetch로 확인한 `origin/main` **`4af565a4cb4d53627bfe17a790e402d00a1a95ea`** (#331 squash merge `aedb880` 포함)이다.
`git merge --no-commit --no-ff origin/main`으로 통합했으며, 사용자 최종 검수 전에는 Commit·Push·원격 PR 병합을 하지 않는다.

마지막 원격 점검 중 main이 `aedb880`에서 `4af565a`로 전진했다. 추가 변경은 Auth 배포 문서·설정 2파일뿐이다. 통합 수정본을 저장소 밖에 백업하고 커밋 없는 병합을 최신 main으로 재구성했다. 프론트엔드 전체 트리가 테스트 완료본과 동일함을 확인했으며, 추가 커밋의 배포 파일은 수정 없이 그대로 반영했다.

## 충돌 및 보존

실제 충돌은 `src/index.css` 한 파일이었다. 같은 위치에 추가된 #340의 `.logout-recovery`와 #267의 `.stock-notice / .stock-warning`을 각각 독립 규칙으로 보존했다. ours/theirs 일괄 선택, rebase, 다른 브랜치 복사는 하지 않았다.

- #267: IN-01 재고 표시·품절·수량 검증·최종 재고 확인·요청 취소 및 UI/CSS 보존.
- #331: 사이드바·하단 장바구니·레드닷·이미지·아이콘, 상세/장바구니 History, 비 JSON Checkout 401/403, 실패/재고 만료 안내, 로그인 대기 의도 폐기 및 이미지 README 보존.
- #340: 관리자 5개 화면·공통 로그인·역할 경계·인증 복원, 로그아웃 재시도·메뉴 권한 회수·늦은 응답 차단 및 제품/fixture 분리 보존.
- 양쪽 테스트와 기존 검증 문서는 삭제하지 않았다. main에 포함된 다른 서비스·인프라 파일은 그대로 병합했으며 이번 통합에서 직접 수정하지 않았다.

## 기존 실패 2건

1. `integration-boundary-browser.mjs` E3는 최신 main 통합 직후에도 실패했다. #267의 재고 우선 검증이 PAUSED를 **판매 중지**로 안내하므로, 이전 addItem 오류 문구를 기다리는 기대값이 낡았다. 현재 문구를 확인하면서 상세 재조회 횟수·장바구니 원본·저장 0회 검증을 그대로 유지했다. 최종 **11/11 PASS**.
2. `stock-browser.mjs`는 기본 주소(현재 홈)에 접속한 뒤 숨겨진 메뉴 카드를 기다려 실패했다. 검증 대상인 `#menu-list` 직접 진입으로 수정했다. 품절·합산 수량·재조회·오류·지연 응답·주문 차단·모바일 검증은 그대로다. 최종 **9/9 PASS**.

둘 다 백엔드 계약 변경이 필요하지 않은 프론트엔드 테스트 통합 문제였다.

## 추가 통합 보완

- 관리자 통합 HTTP fixture의 고객 IN-01 요청이 Cooking fixture로 전달되던 문제를 기존 고객 HTTP fixture로 전달하도록 수정했다. 제품 API 코드는 바꾸지 않았다. 역할 테스트의 고객 주문 재개와 관리자 로그인 시 의도 폐기를 재검증했다.
- #340은 인증 종료 시 계정 화면을 내리고 #home으로 복귀한다. 비밀번호 변경 성공·Refresh 실패 안내가 이 과정에서 사라지지 않도록 기존 AuthSession reason을 이용해 공통 홈에 표시한다. 보호 데이터·입력은 복원하지 않으며 새 로그인 시 안내는 사라진다. AuthSession/Auth API 계약은 바꾸지 않았다.
- 마이페이지/고객 탐색 테스트는 인증 종료 후 홈 복귀와 폼 제거, 관리자 역할의 고객 화면 차단을 검증하도록 맞췄다. PATCH 횟수·Refresh 횟수·장바구니 보존·빈 비밀번호·계정 경계 검증을 유지했다.
- 역할 테스트의 Checkout 버튼은 #331의 확정 문구 **결제 금액 확인**을 사용한다. 기존 쓰기 횟수·선택 보존·무단 API 차단 검증은 유지했다.
- 드래그/미리보기 테스트는 중복되는 로그인 버튼을 헤더로 한정하고, #331이 제거한 불필요한 홈 로그인 안내 대신 보호 주문 영역 미노출을 확인한다.
- Checkout 테스트는 History/unmount가 취소한 **IN-01 GET의 net::ERR_ABORTED만** 예상 취소로 구분한다. 다른 네트워크 오류·HTTP 실패·변경 요청 실패는 계속 실패시킨다. 주문/결제/장바구니 검증은 삭제하지 않았다.

## 실제 실행 결과

- 전체 Node: **766 PASS, 실패/스킵 0**.
- Chromium: 저장소의 **28개 브라우저 스크립트 전부 PASS**. 명시 시나리오 **438건**과 별도 마이페이지 연속 회귀 **1회**를 완료했다.
- 기존 요구 회귀: 역할/인증 **53**, 통합 관리자 **55**, 기존 관리자 **80** (주문 10·재고 27·대시보드 22·조리 21), 고객 HTTP/홈/주문/인증 **63**, 리뷰 수정 **20** 모두 PASS.
- 추가: 재고 9, 로그인 History 7, 장바구니 복귀 8, Checkout 32, 경계 11, 고객 탐색 10, 닉네임/이미지/UI 7, 알림 4, 비회원 장바구니 16, 회원가입 13, 계정 복구 14, 메뉴 HTTP 6, 드래그 23, 고객 미리보기 6, 지연 주문 의도 1, 마이페이지 연속 회귀 1회 PASS.
- Vite Build 및 `check:admin-boundary` PASS. fixture·검수 계정·Mock이 제품 번들에 포함되지 않는 것을 확인했다.
- Windows checkout 전체 Prettier는 기존 CRLF 파일 **169개**에서 실패했다. 관련 변경 파일은 Prettier를 적용하고, 전체 파일은 Git LF 스냅샷 기준으로 검증하여 PASS했다. unrelated 파일 전체 포맷은 하지 않는다.
- 최종 staged/working git diff --check PASS, 미해결 충돌 0개.

QA 산출물은 저장소 밖 `C:/M/Peak_Order-340-merge-qa/`에 있다. 초기 실패 로그와 최종 성공 로그를 구분한다. `browser-final.json`, `node-final.log`, `customer-preview-final.log`, `live.json`이 최종 실행 근거다.

## 사용자 검수

실행 중인 통합 URL: **http://127.0.0.1:5308/#home** (HTTP 200 및 실제 Chromium 로딩 확인).

실행 명령:

```powershell
cd C:\M\Peak_Order\services\web-frontend
$env:PORT = '5308'
npm.cmd run preview:admin-integration
```

- 공통 로그인: `customer@example.test` / `admin@example.test`; 검수 전용 비밀번호는 `fixture-only-password`.
- CUSTOMER: 홈 → 메뉴 → 상세 → 장바구니 → 주문 확인·모의 결제, 주문 내역·마이페이지. 관리자 URL은 고객 홈으로 복귀한다.
- 로그아웃 후 같은 폼에서 STORE_ADMIN 로그인 → #admin. #admin/menus, #admin/orders, #admin/inventory, #admin/cooking을 왕복한다. 고객 URL은 관리자 대시보드로 복귀한다.
- 하단 **통합 시나리오**, **로그아웃 응답**, **메뉴 목록 응답**, **메뉴 저장 응답**으로 정상·권한·인증·장애·재시도를 확인한다. 전체 시나리오 변경은 fixture 인증/데이터를 초기화한다.
- 5308은 이번 통합 코드를 빌드한 새 fixture이다. 기존 5260·5304·5305·5306·5307 및 다른 worktree는 변경하거나 종료하지 않았다.
- 실제 5308에서 공통 로그인 양쪽 역할, 고객 담기 후 상세 재노출 없음, 관리자 5개 화면·활성 메뉴·로그아웃, 1440/390/320px 가로 넘침 없음을 확인했다.

## 제한

로컬 HTTP fixture 검증이며 실제 Gateway·dev/prod E2E와 서버의 관리자 API 활성화 상태는 검증하지 않았다. GitHub CI는 Commit/Push를 하지 않아 새 통합 코드에 대해 실행되지 않았다.

로그아웃 실패 시 Refresh 쿠키가 남으면 새로고침 후 인증이 복원되는 기존 제한과 다른 탭의 계정으로 GET이 재시도될 수 있는 기존 AuthSession 문제는 변경하지 않았다. [리뷰 수정 기록](review-340.md)의 보안 검증과 대안을 따른다.

통합 fixture는 기존 #304의 인증·메뉴·주문·재고 계약 데이터를 재사용한다. 계정 정보/비밀번호 변경 및 회원가입의 전체 계약 검증은 각각 전용 fixture 기반 브라우저 회귀에서 수행했다. 통합 주소의 단순 계정 응답을 실제 Auth 저장 성공 근거로 사용하지 않는다.
