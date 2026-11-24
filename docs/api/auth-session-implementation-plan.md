# Auth 세션 API 구현 준비 — Issue #149

> 현재 상태(2026-11-23): 구현 PR #164와 배포 PR #181 병합, Auth dev 배포 완료. 최신 계약·실행 결과는 [Auth 연동 계약](auth-session-contract.md)을 따른다. 아래 구현 준비·제안·검증 기록은 작성 당시 이력이며, 미정 Gateway/브라우저 계약을 확정으로 바꾸지 않는다.
> 구현 기준: origin/main `aa7de274bbc8bbb3d9f3cc8a9247f6e9651b8b06`, 2026-11-20. 기존 설계 파일을 보존하고 작업 브랜치만 fast-forward했다.
> 작업 브랜치: `feat/149-auth-session`.

- 구현 추적: [Issue #149](https://github.com/ktcloud-cloudnative-2026/team02-5xx/issues/149)
- Auth 담당 계약: [#112 결정안](https://github.com/ktcloud-cloudnative-2026/team02-5xx/issues/112#issuecomment-7002438953)
- 프론트 호환 확인: [은제님 검토 결과](https://github.com/ktcloud-cloudnative-2026/team02-5xx/issues/112#issuecomment-7002604932)
- 추가 정책 제안: [다중 탭·오류 코드 확인 요청](https://github.com/ktcloud-cloudnative-2026/team02-5xx/issues/112#issuecomment-7002777306)
- 팀 규칙: [CLAUDE.md](../../CLAUDE.md), [AGENTS.md](../../AGENTS.md)
- 기존 명세: [API](notion-draft.md), [ERD](../erd/notion-draft.md)
- 기존 구현: [Auth README](../../services/auth-service/README.md)

## 1. 합의된 범위

AU-01 로그인·AU-02 내 정보·AU-09 재발급·AU-10 로그아웃의 Method/URL·필드·상태 코드는 #112 담당 결정안을 따른다. 프론트 담당이 필드와 흐름의 호환성을 확인했지만 실제 토큰 연동을 검증한 것은 아니다.

Access는 메모리·900초, Refresh는 HttpOnly 쿠키·기본 1일/rememberMe=true 14일. rememberMe 기본 false, 로그인 시 정한 Refresh 절대 만료 유지, 성공 시 회전, 현재 로그인 세션만 로그아웃한다. 기존 가입·중복 확인·Argon2id·역할·공통 응답을 유지한다.

신규 직접 의존성은 사전 승인된 spring-security-oauth2-jose만 사용한다. 7.1.2는 기존 Boot 4.1.2 BOM 기준이며 Nimbus JOSE JWT 10.9.1은 전이 의존성이다. 실제 추가 전 최종 dependency tree를 확인한다. 사용자 구현 지시에 따라 승인된 JOSE 의존성을 추가했고, runtimeClasspath에서 7.1.2 및 Nimbus 10.9.1을 확인했다.

## 2. 다중 탭 Refresh 처리 제안 — 프론트 확인 전

서버는 동일한 이전 Refresh를 보낸 정상 탭과 탈취자를 토큰만으로 구별할 수 없다. IP·User-Agent가 같다는 이유로 재사용을 정상으로 인정하지 않는다.

제안하는 기본 동작:

1. 한 Refresh의 회전은 DB 트랜잭션과 잠금으로 직렬화하고 한 요청만 성공시킨다.
2. 이미 사용된 Refresh를 다시 받으면 401로 거절하고, 그 토큰과 같은 로그인 세션의 활성 Refresh를 폐기한다. 다른 기기·새 로그인 세션까지 폐기하지 않는다.
3. 경쟁에서 먼저 200을 받은 요청도 뒤의 재사용 탐지로 세션이 폐기될 수 있다. '200을 받았으니 그 세션이 계속 유효하다'고 가정하지 않는다.
4. 폐기된 Refresh로부터 새 쿠키를 발급하지 않는다. 실패 응답이 나중에 도착해 다른 새 로그인 쿠키를 지우지 않도록, Refresh 실패 시 Set-Cookie 삭제 여부는 명시적으로 계약한다.
5. 프론트는 같은 탭의 요청 묶기와 탭 간 조정을 포함해 AU-09를 하나씩 실행한다. 새로고침·새 탭의 초기 세션 복원도 같은 조정 경로를 사용한다. 구체적인 브라우저 도구·폴백은 프론트 담당이 선택한다.
6. 회전 응답 유실 후 이전 토큰 재시도도 재사용으로 처리될 수 있다. 이 경우 재로그인이 필요하며 '네트워크 오류면 안전하게 재시도 가능'이라고 표시하지 않는다.
7. 유예 시간 내 이전 토큰 재사용 허용·동일 Refresh 중복 발급·새 Refresh 원문 재전송 캐시는 기본안에 추가하지 않는다. UX 때문에 필요하면 별도 위협 검토와 계약 확인을 거친다.

이 방식은 탈취된 토큰 재사용을 차단하지만 정상 경합도 재로그인으로 이어질 수 있다. 따라서 **보안과 사용자 경험의 선택을 프론트와 확인할 제안**이며 확정된 추가 계약으로 표시하지 않는다.

근거: [RFC 9700 §4.14.2](https://www.rfc-editor.org/rfc/rfc9700.html#section-4.14.2)의 Refresh 회전·재사용 탐지 원리를 참고했다. 이 프로젝트가 OAuth 서버 전체를 구현한다거나 해당 문서가 팀의 확정 명세라는 의미는 아니다.

## 3. 오류 계약에서 남은 확인

기존 공통 success/data/message/errorCode 형식을 유지한다. 아래 코드는 **제안**이며 #112에서 프론트 확인 후 고정한다.

| 상황                           | HTTP | errorCode 후보          |
| ------------------------------ | ---- | ----------------------- |
| 로그인 실패·무효 Access        | 401  | UNAUTHORIZED            |
| Refresh 없음·식별 불가         | 401  | REFRESH_INVALID         |
| Refresh 만료                   | 401  | REFRESH_EXPIRED         |
| 폐기된 로그인 세션             | 401  | REFRESH_REVOKED         |
| 사용한 Refresh 재사용          | 401  | REFRESH_REUSED          |
| 허용되지 않은 Origin·CSRF      | 403  | REQUEST_ORIGIN_REJECTED |
| 현재 로그인 사용자의 권한 부족 | 403  | FORBIDDEN               |

프론트는 위 Refresh 401 모두 갱신 반복 없이 재로그인으로 끝내고, 403에는 Refresh를 호출하지 않는다. 정상 만료와 재사용 탐지의 서버 측 폐기 범위는 구분한다. 실제 Gateway 401 형식은 해당 담당 확인 전 미정이다. 기존 다른 서비스의 errorCode·403/404 계약은 수정하지 않는다.

## 4. 구현 파일 및 순서

아래 역할의 로컬 구현을 추가했다. 실제 생성 파일은 Git 상태 및 Auth README를 확인한다.

| 위치                               | 예정 역할                                                  |
| ---------------------------------- | ---------------------------------------------------------- |
| services/auth-service/build.gradle | 승인된 JOSE 의존성 연결                                    |
| controller·dto                     | AU-01/02/09/10, strict Boolean, 기존 응답 봉투 및 OpenAPI  |
| service                            | 로그인 검증, 현재 사용자, 회전·현재 세션 로그아웃          |
| config                             | 키·issuer/audience·쿠키·Origin 설정, 기존 가입 설정과 분리 |
| entity·repository                  | Refresh 해시·세션·만료·폐기 저장 및 잠금                   |
| exception                          | 기존 오류 보존, 확인된 인증 오류 추가                      |
| db/migration/V2__*.sql             | 기존 V1 유지, Refresh 구조 추가 제안의 승인·리뷰 반영      |
| src/test                           | 서비스·HTTP·격리 로컬 PostgreSQL 회귀                      |
| services/auth-service/README.md    | 실행 설정·테스트·미검증 범위                               |

최소 구현 순서는 설정/키 검증 → 로그인·내 정보 → Refresh 저장/회전 → 로그아웃 → HTTP/쿠키/출처 검증 → 회귀 및 문서다. 원본 API·ERD, 다른 서비스, CI 공통 실행기는 수정하지 않는다.

DB 보조 컬럼은 session_id·remember_me 제안을 유지한다. 로그인 세션 단위로 회전·폐기를 직렬화한다. 기존 users 행 잠금 등을 사용해 회전과 세션 전체 폐기의 경합을 막는 방법을 검토하고, 다른 로그인 세션의 토큰을 폐기하지 않도록 세션 조건을 검증한다. 토큰이 여러 행으로 회전하는 동안 새 토큰이 폐기 범위에서 빠지는 경쟁도 테스트한다.

재사용 감지 후 폐기 상태가 401 예외의 rollback으로 취소되지 않아야 한다. 폐기 결과를 트랜잭션에서 commit한 뒤 오류로 매핑하는 등 경계를 명확히 하며 별도 트랜잭션에서 DB 상태를 다시 확인한다.

## 5. 검증 시나리오 — 로컬 회귀에서 실행

| 영역                | 확인할 결과                                                                |
| ------------------- | -------------------------------------------------------------------------- |
| 기존 회귀           | 가입·이메일 중복·약관·Argon2id·Swagger 동작 유지                           |
| 로그인              | 성공 필드·900초, 잘못된 자격 증명 401, role/status 요청으로 권한 상승 불가 |
| 입력                | rememberMe 생략/true/false, 문자열·숫자·배열 등의 잘못된 값 거절           |
| JWT                 | 서명·만료·issuer/audience·역할 검증, 개인키 응답/로그 노출 없음            |
| 내 정보             | 현재 계정 상태 확인, nickname null, 무검증 신원 헤더 거절                  |
| 만료                | 1일/14일 및 시계 경계, 회전 후 최초 절대 만료 유지                         |
| Refresh 정상        | 이전 토큰 폐기·새 해시 저장·원문 미저장·동일 JSON 구조                     |
| 같은 토큰 동시 호출 | 200 한 건만 가능, 중복 성공 없음. 재사용 폐기 안 채택 시 새 Refresh도 거절 |
| 서로 다른 세션      | 같은 회원의 다른 로그인 세션은 보존                                        |
| 회전/로그아웃 경합  | 로그아웃 이후 살아남는 해당 세션 Refresh 없음                              |
| 재사용 rollback     | 401 이후 별도 트랜잭션에서 세션 폐기 commit 확인                           |
| 응답 유실           | 이전 토큰 재시도 결과와 재로그인 처리 확인                                 |
| 로그아웃            | 만료 Access·쿠키 없음·반복 호출 204, 본문 없음                             |
| 쿠키·출처           | 결정된 속성·삭제 Path 일치, 실패·거부 때 잘못된 쿠키 발급 없음             |
| 로컬 DB             | 허용된 로컬 테스트 DB만 사용, V1 체크섬 보존·V2 검증·저장 실패 rollback    |

모의 단위/HTTP 테스트는 브라우저의 Secure·SameSite·CORS 동작 증명이 아니다. 실제 HTTPS 브라우저, Gateway A/B·헤더 위조/우회, Menu 역할 검사는 별도 담당·통합 검증 항목이다.

## 6. 완료 범위와 남은 작업

- 완료: AU-01/02/09/10 및 공개 JWKS 로컬 코드, V2 Refresh 저장, 승인 JOSE 연결, 사용법.
- 기존 회원가입·이메일 정규화·Argon2id·V1·공통 CI 등록/실행기는 보존했다.
- Session API는 기본 비활성이다. 활성화 시 외부 주입 키·issuer/audience·허용 Origin을 요구하며 기본 키를 생성하지 않는다.
- 구현한 로컬 기준: RS256, Secure/Strict/host-only 쿠키, Origin/Referer allowlist, 엄격한 재사용 시 현재 세션 폐기.
- 이 기준은 사용자 지시로 작성한 로컬 검토안이며 미정인 공통 연동 계약을 일괄 확정한 것은 아니다. 프론트 추가 확인 전 배포하지 않는다.
- 오류는 확정된 공통 UNAUTHORIZED(401)/FORBIDDEN(403)를 유지했다. 3절의 세분화 코드는 구현하지 않았다.
- 테스트에서만 메모리/임시 키와 루프백 일회용 PostgreSQL 16을 사용하고 컨테이너·키·자격 증명을 정리했다.
- 검증된 항목: 기존 가입 회귀, JWT 변조·다른 키/HMAC·필수 claim·시간, 실제 HTTP 요청·JWKS 검증키, 동시 회전/로그아웃, 폐기 commit 및 실패 rollback, V1/V2 Flyway 검증.
- 미검증: 실제 HTTPS 브라우저 쿠키, Gateway JWT/신원 헤더/우회 차단, 프론트 다중 탭·응답 유실 처리, 다른 서비스 관리자 권한, GitHub Actions의 이 변경 실행.
- 남은 계약/운영: 다중 탭 세부 UX·세분화 오류, 배포 쿠키·CORS·Origin·issuer/audience/JWKS 운영 주소, 키 교체·과거 Refresh 행 정리.
- 제출 시 인증·DB·서비스 간 계약 필수 리뷰를 명시하고 작성자 외 팀원 1명 승인을 받는다. commit·push·PR·실제 DB/배포 변경은 하지 않았다.

최종 실행 수치는 JUnit XML 및 작업 결과 보고를 기준으로 기록한다. 현재 구현 결과를 main 반영·Gateway 연동 완료로 표시하지 않는다.

## 7. 최종 로컬 검증 기록 (2026-11-20)

- Java 21, Gradle Wrapper 8.14.3, Spring Boot 4.1.2.
- Auth JUnit **125개 통과, 실패·오류·생략 0**. 기존 58개를 보존했고 로컬 PostgreSQL 테스트 16개를 포함한다.
- spotlessCheck·test·build 성공. 임시 PostgreSQL 16 컨테이너에서 V1/V2를 실제 적용·검증했다.
- 공개 JWKS 실제 HTTP 응답으로 발급 JWT 서명을 검증했다. 실제 운영 키·Gateway 연결을 검증한 것은 아니다.
- JOSE 7.1.2 → Nimbus JOSE JWT 10.9.1 runtimeClasspath 확인. 다른 새 라이브러리 추가 없음.
- 기존 공통 CI 회귀 실행 종료 코드 0, 서비스 준비 검사 등록 7개/필수 파일 준비 7개. 이 준비 결과는 다른 서비스 빌드·테스트 성공을 뜻하지 않는다.
- Prettier 3.10.0 문서 검사·상대 링크·git diff --check 통과. V1 정규화 Git 해시와 원본 API/ERD·CI·배포 파일 보존 확인.
- 변경 31개(기존 파일 수정 9개·신규 22개), Auth 및 이 설계 문서에 한정. 키·환경 비밀값·빌드 산출물은 변경 목록에 없음.
- 테스트 컨테이너·임시 키·테스트 자격 증명 정리 완료. 기존 작업 폴더와 Gradle 캐시는 보존했다.
- commit·push·PR 생성·공용 서버/DB·배포 변경 없음.

## 8. 최종 검토 후 보완 검증 (2026-11-20)

- AU-02 `/me`의 401 응답에만 `WWW-Authenticate: Bearer`와 `Cache-Control: no-store`를 추가했다. 로그인·Refresh 401 및 서비스 비활성 503에는 Bearer 안내를 붙이지 않는다. 기존 JSON 오류 계약은 유지한다.
- 로그인 이메일은 원본 입력을 1,024자로 제한하고 기존 공통 정규화에서 공백 제거 후 254자 제한을 검사한다. 공백을 포함한 최대 길이 이메일도 가입과 같은 기준으로 처리하며, 공백 제거 후 255자 이상 및 과도한 원본 입력은 거절한다.
- 회귀 테스트 9개 추가 후 Auth JUnit **134개 통과, 실패·오류·생략 0**. 기존 125개와 로컬 PostgreSQL 통합 테스트 16개를 포함한다.
- Java 21·기존 Gradle 캐시와 일회용 PostgreSQL 16-alpine으로 `spotlessApply spotlessCheck test build`를 실행해 성공했다. 테스트 DB 컨테이너·임시 로그·자격 증명은 정리했다.
- CI 공통 로직·다른 서비스·원본 API/ERD·배포 설정은 수정하지 않았다. GitHub Actions·HTTPS 브라우저·Gateway 연동 등 기존 미검증 항목은 남아 있다.
