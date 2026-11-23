# 고객 회원가입 — Issue #257

기준은 main `eac2e88c7da2ed894689d4868713467c975ee3f4`, Issue #257, Auth RegistrationController/RegistrationService/EmailAddress/DTO 및 `docs/api/auth-registration-design.md`다.
승인 대기 #132·#251·#256은 병합하거나 복사하지 않았다. 로컬 `design-reference/menu-ui/04_회원가입.png`의 입력·중복 확인·개별/전체 약관 구성을 참고하고, 기존 LoginModal/dialog/고객 스타일을 재사용했다. 시안의 8자·문자종류 규칙 대신 현재 서버 기본 12~64 Unicode 코드 포인트를 사용한다.

## 동작과 계약

- 로그인 모달의 회원가입 버튼으로 같은 dialog 안에서 가입 폼을 연다. 새 라우터나 별도 페이지/History entry는 만들지 않는다. 로그인 복귀 버튼, Escape/뒤로가기·포커스·본문 스크롤은 기존 흐름을 따른다. 부모 App의 보류된 주문 의도를 가입 과정에서 소비하거나 복제하지 않는다.
- 이메일 중복 확인은 명시적 AU-04 `GET /api/v1/auth/email-availability?email=...`이다. 형식/길이 기본 검사, 바깥 공백 제거·도메인만 소문자화하며 local-part 대소문자는 유지한다. 서버의 Jakarta @Email/Java strip 검사가 최종 기준이며 프런트의 기본 검사와 Unicode/특수 이메일 전체가 동일하다고 주장하지 않는다.
- 이메일을 편집하면 확인 결과를 즉시 무효화하고 요청을 취소한다. 취소를 무시한 응답도 세대로 차단한다. 새 요청이나 가입 중에는 중복 호출을 막는다.
- AU-03 `POST /api/v1/auth/register`는 email/password/agreements만 보낸다. 확인 비밀번호·role·토큰·신원 헤더를 보내지 않는다. credentials same-origin, redirect error, no-store, 15초 제한은 기존 Auth transport를 재사용한다.
- 비밀번호는 메모리 입력 상태에서만 사용한다. trim/normalize·로그·local/sessionStorage 저장을 하지 않는다. 서버로 보낸 뒤 성공/실패 모두 비밀번호와 확인값을 지우며 모달 이탈은 요청을 취소한다.
- TERMS/PRIVACY 개별 동의와 전체 동의가 동기화된다. 약관 전문과 버전을 확인할 수 있어야 하며 catalog가 교체되면 기존 동의를 해제한다. 정상 요청 후 201의 양의 safe integer id와 일치하는 email을 검증한다.
- 가입 성공은 로그인 화면 복귀·이메일 채움과 완료 안내만 제공한다. 자동 로그인/세션 생성은 없다. 실제 로그인에 성공했을 때만 기존 보류 주문 흐름이 한 번 재개된다.
- 서버 400 INVALID_REQUEST/REQUIRED_AGREEMENT_MISSING/INVALID_AGREEMENT_VERSION, 409 EMAIL_ALREADY_EXISTS, 503 REGISTRATION_UNAVAILABLE을 고정된 안전 문구로 매핑한다. 서버 예외/원문 메시지는 노출하지 않는다. 네트워크·timeout·응답 불명은 가입 성공으로 취급하지 않고 자동 POST 재시도도 하지 않는다. 실패 후 이메일을 다시 확인해야 하며 서버의 최종 중복 검사(409)를 존중한다.

## 시연용 약관 demo-v1

사용자 지시에 따라 교육·포트폴리오 목적의 시연용 이용약관과 개인정보 처리방침을 직접 작성했다. `src/registration/registrationTerms.js`에서 전문과 버전을 별도 관리하며 TERMS·PRIVACY 모두 **demo-v1**이다. 가입 제출은 활성화되어 있고 기존 입력·중복 확인·필수 동의·제출 중 검증은 유지한다. 각 전문 보기에서 전체 내용을 읽을 수 있으며 내부 스크롤·키보드 접근·Escape 닫기 및 summary 포커스 복귀를 제공한다. 전문을 닫아도 입력과 동의를 보존한다.
메뉴·회원가입·주문·실제 금전 결제가 없는 모의 결제를 설명한다. Auth User/UserAgreement/refresh_tokens와 RegistrationService·Argon2 설정을 확인해 저장 항목·원문 비밀번호 미저장·현재 미수집 선택 항목을 구분했다. 구현되지 않은 자동 삭제·실제 환불·운영 보안을 보장하지 않는다. 상용 서비스용 법률 검토 완료 문서로 주장하지 않는다.
**Auth 서버의 AUTH_TERMS_VERSION=demo-v1 및 AUTH_PRIVACY_VERSION=demo-v1이 필요하다.** 이번 작업에서 서버 환경 변수·배포 설정·DB는 변경하지 않았다. 다른 버전의 서버는 400 INVALID_AGREEMENT_VERSION으로 거절하며 폼은 제출을 차단한다. 버전이 없는 서버는 503을 반환한다. 관리자 JWT/Gateway 신원 헤더 문제와 별개인 공개 AU-03·04 계약이다.
서버 버전 미설정 시 503인 기존 계약도 유지한다. 비밀번호 정책은 서버 환경에서 변경될 수 있으므로 운영 활성화 전 기본 12~64와의 정합성도 확인해야 한다.

## 검증 범위

`registration.test.js`는 실제 HTTP adapter의 경로·요청 필드·반환 DTO·오류·비밀번호 원문/Unicode 보존·timeout/취소와 demo-v1 전문 및 잘못된 catalog 차단을 검증한다.
`registration-browser.mjs`는 실제 Chromium에서 제품 App과 기존 Auth/Menu/Checkout HTTP fixture를 사용한다. 기본 테스트 entry도 제품 demo-v1을 사용한다. 누락 catalog는 실패 안전성 테스트에서만 주입한다. 제품에 테스트 성공 분기나 인증 우회를 넣지 않는다. `tests/registration-terms.js`의 별도 합성 catalog는 adapter 단위 테스트 전용이다.
fixture는 AU-03/04의 합성 응답이며 새 비밀번호 저장/해싱/계정 DB를 구현하지 않는다. 따라서 가입 후 새 계정의 실서버 로그인까지 증명하지 않는다. 보류 주문 회귀는 기존 테스트 CUSTOMER로 명시적으로 로그인해 한 번만 재개되는지 확인한다.
정상·409/400/503·네트워크·이메일 응답 경합·중복 요청·언마운트·동의 동기화·포커스/스크롤·History·320/390px와 기존 고객 Auth·장바구니·Checkout 회귀를 실행한다. 기존 테스트 서버가 제품 기본 SVG를 제공하지 않아 발생한 404만 공유 fixture에서 보완했다.
실행 수치는 최종 작업 보고와 저장소 밖 `%TEMP%\peak-order-257`의 JSON/로그/스크린샷을 기준으로 한다. 실제 Auth/DB/Gateway·HTTPS 쿠키·배포·GitHub CI는 미검증이다.

변경은 web-frontend에만 한정한다. 기존 로컬 bin·다른 브랜치와 승인 대기 PR을 보존하며 Commit·Push·PR 생성·병합은 수행하지 않는다.

## Windows 수동 화면 검수

`services/web-frontend`에서 `node tests/registration-preview.mjs`를 실행하고 콘솔의 `http://127.0.0.1:<port>/?preview=1#menu-list`로 접속한다. React 제품 App·HTTP adapter를 기존 fixture 빌더로 제공하는 로컬 HTTP 서버이며 실제 Auth/Gateway가 아니다. 검수 종료 전 서버를 유지한다.

상단 테스트 안내의 정상/409 중복/400 입력 오류/400 약관 버전/503/연결 끊김 링크로 시나리오를 선택한다. 링크는 시연용 가입 중복 목록을 초기화하고 고객 화면으로 돌아간다. 로그인 → 회원가입에서 합성 이메일(`review@example.test` 등), 12~64자 임시 비밀번호, 중복 확인, 전문 보기, 개별/전체 동의 후 제출한다. `taken@example.test`는 중복 확인 자체가 불가 상태다. 정상 등록한 이메일은 같은 서버에서 다음 중복 확인 때 사용 불가로 표시된다.

fixture 등록은 성공 DTO만 시연하며 새 계정 DB·새 계정 로그인은 구현하지 않는다. 기존 로그인은 `customer@example.test` 또는 `admin@example.test`, 비밀번호 `fixture-only-password`로 확인한다. 실제 개인정보나 다른 서비스의 비밀번호는 입력하지 않는다. 브라우저 새로고침/다른 시나리오 전환 시 입력값은 보존하지 않으므로 먼저 가입 폼을 닫거나 검수를 마친 뒤 전환한다.

정상 가입 → 로그인 복귀 안내, 오류 후 비밀번호 지움·이메일 재확인, 장바구니 보존, 모바일 전문 스크롤, Tab/Shift+Tab·Escape·뒤로가기를 직접 확인한다. 이 서버는 같은 Windows PC의 로컬 브라우저에서 접근하는 loopback 전용 서버이며 외부 공개 서버가 아니다.
