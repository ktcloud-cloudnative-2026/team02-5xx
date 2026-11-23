# Auth Service

피크오더 Auth Service입니다. Issue #94에서 이메일 회원가입·이메일 중복 확인과 회원·약관 동의 저장을 추가했습니다.
담당자는 이태훈(@lth1202)이며 공통 규칙은 [CLAUDE.md](../../CLAUDE.md)를 따릅니다.

## 개발 환경

| 항목               | 버전                        |
| ------------------ | --------------------------- |
| Java               | 21                          |
| Spring Boot        | 4.1.2                       |
| Gradle Wrapper     | 8.14.3                      |
| Spotless           | 7.2.1                       |
| Google Java Format | 1.28.0                      |
| springdoc-openapi  | 3.2.0                       |
| JUnit Jupiter      | 6.0.3, Spring Boot BOM 관리 |

Gradle group은 `com.peakorder`, 기본 패키지는 `com.peakorder.auth`입니다.
Java 21 JDK를 `JAVA_HOME` 또는 `PATH`로 지정합니다.
최초 실행 시 Gradle 배포 서버, Gradle Plugin Portal, Maven Central에서 배포본과 의존성을 내려받습니다.

## 빌드·테스트·포맷 검사

다음 PowerShell 명령은 `services/auth-service`에서 실행합니다.

```powershell
.\gradlew.bat --version
.\gradlew.bat spotlessCheck
.\gradlew.bat test
.\gradlew.bat build
```

Java 포맷 적용은 다음 명령으로 수행합니다.

```powershell
.\gradlew.bat spotlessApply
```

Linux·macOS에서는 `.\gradlew.bat`을 `sh ./gradlew`로 바꿔 실행합니다.
`build`에는 테스트와 Spotless 검사가 연결됩니다.
기존 테스트 3개는 DB를 격리한 웹 애플리케이션 기동, OpenAPI JSON, Swagger UI HTML·JavaScript 응답을 검증합니다. 회원가입 서비스·HTTP 테스트와 선택적으로 실행하는 실제 PostgreSQL 테스트를 함께 제공합니다.
실제 서버를 임의 포트로 시작하며 테스트 결과는 `build/reports/tests/test/index.html`에서 확인합니다.

## 애플리케이션 실행

로컬 확인용 주소와 포트를 실행 인자로 지정할 수 있습니다.

```powershell
.\gradlew.bat bootRun --args="--server.address=127.0.0.1 --server.port=8080"
```

빌드된 실행 JAR로도 실행할 수 있습니다.

```powershell
java -jar build/libs/auth-service-0.0.1-SNAPSHOT.jar --server.address=127.0.0.1 --server.port=8080
```

종료할 때는 `Ctrl+C`를 누릅니다.

## Swagger UI·OpenAPI

8080 포트로 실행한 경우 다음 주소를 확인합니다.

- Swagger UI <http://127.0.0.1:8080/swagger-ui.html>
- OpenAPI JSON <http://127.0.0.1:8080/v3/api-docs>
- Swagger UI 연결 설정 <http://127.0.0.1:8080/v3/api-docs/swagger-config>

`springdoc-openapi-starter-webmvc-ui`가 문서와 UI를 자동 구성합니다.
회원가입·이메일 중복 확인과 Issue #149의 세션 API를 OpenAPI에 제공합니다. 신규 세션 기능은 기본 비활성이며 아래 활성화 설정을 참고합니다.

## 패키지 구성

애플리케이션 진입점은 `com.peakorder.auth.AuthServiceApplication`입니다.
팀의 계층형 패키지 기준은 기본 패키지 아래의 `controller`, `service`,
`repository`, `dto`, `entity`입니다.
controller·service·repository·dto·entity와 config·exception 계층으로 회원가입 기능을 구성합니다.
서비스 전용 `.editorconfig`, `.gitattributes`로 Java 들여쓰기와 줄바꿈을 관리합니다.

## 공통 CI 연결

저장소 `.github/ci/services.json`에 다음 항목을 등록합니다.

```json
{
    "id": "auth",
    "path": "services/auth-service"
}
```

main 대상 PR에서 공통 준비 검사가 실행된 뒤 Java 21 환경에서 이 프로젝트의 Wrapper로
`spotlessCheck`, `test`, `build`를 실행합니다.
검사 결과는 `CI Final`에 반영됩니다. [공통 CI 사용법](../../docs/ci.md)을 참고합니다.

## Gradle Wrapper 검증

공식 Gradle 8.14.3 배포본의 SHA-256을 `distributionSha256Sum`에 고정했습니다.
Wrapper JAR도 공식 체크섬과 대조합니다.

| 대상            | SHA-256                                                            |
| --------------- | ------------------------------------------------------------------ |
| Gradle 배포 ZIP | `bd71102213493060956ec229d946beee57158dbd89d0e62b91bca0fa2c5f3531` |
| Wrapper JAR     | `7d3a4ac4de1c32b59bc6a4eb8ecb8e612ccd0cf1ae1e99f66902da64df296172` |

[공식 배포본 체크섬](https://services.gradle.org/distributions/gradle-8.14.3-bin.zip.sha256),
[공식 Wrapper 체크섬](https://services.gradle.org/distributions/gradle-8.14.3-wrapper.jar.sha256)을 기준으로 검증합니다.

## 회원가입 API와 화면 연동

| 동작             | 요청                                          | 정상 응답                           |
| ---------------- | --------------------------------------------- | ----------------------------------- |
| 이메일 중복 확인 | GET /api/v1/auth/email-availability?email=... | HTTP 200, data.email·data.available |
| 회원가입         | POST /api/v1/auth/register                    | HTTP 201, data.id·data.email        |

회원가입 요청안은 다음과 같다. local-test-v1은 로컬 검증에만 사용하는 값이며 실제 약관 버전은 담당자와 맞춘다.

```json
{
    "email": "member@example.test",
    "password": "<사용자가 입력한 비밀번호>",
    "agreements": [
        { "type": "TERMS", "version": "local-test-v1", "agreed": true },
        { "type": "PRIVACY", "version": "local-test-v1", "agreed": true }
    ]
}
```

비밀번호 확인·보기와 전체 동의의 체크 상태는 프론트에서 처리한다. 서버는 password와 각 약관 동의를 검증한다. 이메일 변경 시 이전 중복 확인 결과를 해제하고 이전 이메일의 늦은 응답을 무시한다. 회원가입 시 서버가 중복을 다시 확인하고 DB UNIQUE가 동시 중복 가입을 보호한다.

현재 개발 계약은 이메일 앞뒤 공백 제거·도메인 소문자화·local part 대소문자 유지다. 공개 가입은 CUSTOMER·ACTIVE로 저장한다. nickname·name·phone은 화면 입력 없이 NULL로 시작한다. 제안된 요청 필드 이외의 입력은 HTTP 400으로 거절한다.

비밀번호 길이는 Unicode 코드 포인트 기준 개발 기본값 12~64자이며 공백·문자를 변경하지 않고 해시한다. 길이·이메일 비교·요청 및 응답·약관 필수 여부와 버전은 프론트 연동 전에 확인할 개발 계약이다. 팀의 확정 규격으로 추가한 정책이 아니다.

오류 응답은 success=false, data=null, message, errorCode를 사용한다. 입력 오류 INVALID_REQUEST(400), EMAIL_ALREADY_EXISTS(409), REQUIRED_AGREEMENT_MISSING(400), INVALID_AGREEMENT_VERSION(400), REGISTRATION_UNAVAILABLE(503), INTERNAL_SERVER_ERROR(500)를 구분한다. 비밀번호·저장 해시·내부 DB 오류는 응답과 애플리케이션 오류 로그에서 보호한다.

## DB와 약관 설정

실행 시 AUTH_DB_URL, AUTH_DB_USERNAME, AUTH_DB_PASSWORD를 환경 변수로 제공한다. Hibernate는 validate로 Flyway V1의 users·user_agreements와 매핑을 확인한다. 기존 공용 DB에 대한 적용은 해당 리뷰·운영 절차에서 진행한다.

AUTH_TERMS_VERSION과 AUTH_PRIVACY_VERSION에 화면에서 제공하는 실제 약관 버전을 넣는다. 두 값의 기본값은 빈 문자열이고 값이 준비되지 않은 회원가입 요청은 HTTP 503으로 처리한다. AUTH_PASSWORD_MIN_LENGTH·AUTH_PASSWORD_MAX_LENGTH로 입력 길이를 조정할 수 있다.

비밀번호 저장은 사용자 승인된 spring-security-crypto 7.1.2와 BouncyCastle 1.87의 Argon2id를 사용한다. salt 16바이트·hash 32바이트·메모리 19456 KiB·반복 2회·병렬도 1을 설정했다. JPA·Flyway·PostgreSQL 드라이버·Validation 및 Spring Security Crypto 버전은 Spring Boot 4.1.2 BOM을 사용하고 BouncyCastle만 1.87로 고정한다.

## 격리된 PostgreSQL 검증

Docker PostgreSQL 16을 로컬 루프백의 임시 포트에 실행하고 테스트 전용 DB auth_registration_test를 사용한다. 비밀번호는 프로세스 환경 변수로 전달하며 명령 기록과 파일에 값을 남기지 않는다.

환경 변수 AUTH_DB_TEST_URL, AUTH_DB_TEST_USERNAME, AUTH_DB_TEST_PASSWORD를 준비한 뒤 아래 명령을 실행한다.

```powershell
.\gradlew.bat --no-daemon spotlessApply
.\gradlew.bat --no-daemon test build --rerun-tasks
```

AUTH_DB_TEST_URL은 jdbc:postgresql://127.0.0.1:<로컬포트>/auth_registration_test 형식이다. 통합 테스트는 localhost 또는 127.0.0.1의 이 테스트 전용 DB만 허용하며 테스트마다 users·user_agreements 데이터를 비운다. 통합 테스트의 약관 버전은 local-test-v1이다.

DB 환경 변수가 없으면 DB 통합 테스트가 생략되고 단위·HTTP·기존 기동 테스트를 실행한다. 이 경우 실제 DB 검증은 미실행이다. 공통 CI 실행기·서비스 등록은 기존 구성을 사용한다.

실행 JAR은 AUTH_DB_URL·AUTH_DB_USERNAME·AUTH_DB_PASSWORD와 약관 버전을 제공한 환경에서 로컬 실행한다. /v3/api-docs·/swagger-ui/index.html, 중복 확인, 정상 가입 201, 동일 이메일 재가입 409를 확인한다. 검사 후 임시 애플리케이션과 PostgreSQL 컨테이너를 종료한다.

## 2026-11-18 로컬 검증 결과

Java 21.0.13, Gradle 8.14.3, 격리된 Docker PostgreSQL 16으로 검증했다.

| 검증                                      | 결과                            |
| ----------------------------------------- | ------------------------------- |
| 기존 기동·OpenAPI·Swagger 테스트          | 3개 통과                        |
| 회원가입 서비스 검증                      | 29개 통과                       |
| HTTP 계약·오류·Argon2id 검증              | 18개 통과                       |
| 실제 PostgreSQL·Flyway·동시 가입·롤백     | 8개 통과                        |
| 전체 DB 연결 테스트 실행                  | 58개 통과, 실패·오류·생략 0개   |
| DB 없는 기존 CI 명령                      | 50개 통과, DB 테스트 8개 생략   |
| 잘못된 DB 테스트 URL                      | DB 접속 전 실패 확인            |
| Spotless·Gradle 빌드                      | 통과                            |
| 실행 JAR 회원가입·동일 이메일 재가입      | HTTP 201·409                    |
| 실행 JAR Swagger·OpenAPI·이메일 중복 확인 | HTTP 200 및 가입 전후 상태 확인 |

DB 테스트 실행 여부를 Gradle 입력에 반영하고 실제 DB 테스트의 결과 캐시·UP-TO-DATE 재사용을 차단한다. 테스트용 애플리케이션·PostgreSQL 컨테이너는 검사 후 종료했다. 실제 프론트 화면 연결과 공용 dev DB·Kubernetes 배포는 후속 확인 항목이다.

## Issue #149: 로그인·JWT 세션 API (로컬 구현)

로컬 구현·검증을 완료한 PR 검토 대상입니다. 실제 배포·Gateway 연동 완료와는 구분합니다.
[구현·검증 및 미정 항목](../../docs/api/auth-session-implementation-plan.md)을 함께 확인합니다.

| API                       | 요청                                            | 성공 응답                                               |
| ------------------------- | ----------------------------------------------- | ------------------------------------------------------- |
| POST /api/v1/auth/login   | JSON email/password, rememberMe 선택·기본 false | 200, Access와 user(id/email/role), Refresh는 Set-Cookie |
| GET /api/v1/auth/me       | Bearer Access                                   | 200, id/email/nickname/role                             |
| POST /api/v1/auth/refresh | Refresh 쿠키, 본문 없음, Access 불필요          | 200, 로그인과 같은 data 및 회전한 쿠키                  |
| POST /api/v1/auth/logout  | Refresh 쿠키, 본문 없음, 만료 Access와 무관     | 현재 세션 폐기·쿠키 삭제, 본문 없는 204                 |
| GET /api/v1/auth/jwks     | 공개 검증키 조회                                | 표준 JWK Set: {"keys":[...]}                            |

업무 응답은 기존 success/data/message/errorCode 형식을 유지합니다.
JWKS는 업무 데이터가 아닌 표준 공개키 메타데이터이므로 일반 응답 봉투로 감싸지 않습니다.
로그인 페이지와 모달은 같은 API를 사용합니다. rememberMe에 문자열·숫자·명시적 null을 보내면 400입니다.
입력 누락과 명시적 null은 구분합니다. 비밀번호 저장은 기존 Argon2id 그대로입니다.

### 활성화 설정

기본값은 **AUTH_SESSION_ENABLED=false**입니다. 기존 가입·Swagger는 계속 사용할 수 있으며,
설정되지 않은 세션 API는 503 AUTHENTICATION_UNAVAILABLE로 거절합니다.
활성화할 때는 다음 값을 모두 명시해야 합니다. 키 자동 생성·개발 기본 키는 없습니다.

| 환경 변수                 | 용도                                                         |
| ------------------------- | ------------------------------------------------------------ |
| AUTH_SESSION_ENABLED      | true로 명시적 활성화                                         |
| AUTH_JWT_ISSUER           | 발급자 식별 값 — 실제 환경 값은 Gateway와 확인               |
| AUTH_JWT_AUDIENCE         | 토큰 대상 값 — Gateway와 확인                                |
| AUTH_JWT_KEY_ID           | 1~64자 영문·숫자·하이픈·밑줄                                 |
| AUTH_JWT_PRIVATE_KEY_FILE | Git 밖에서 주입한 RSA PKCS#8 PRIVATE KEY PEM 파일 경로       |
| AUTH_JWT_PUBLIC_KEY_FILE  | 대응하는 X.509 PUBLIC KEY PEM 파일 경로                      |
| AUTH_ALLOWED_ORIGINS      | 정확한 Origin 목록(쉼표 구분). 와일드카드·경로·userinfo 금지 |
| AUTH_REFRESH_COOKIE_NAME  | 로컬 구현 기본값 peakorderRefreshToken                       |

2048비트 이상이며 서로 대응하는 RSA 키 쌍을 요구합니다. 실제 키·DB 비밀값은 Git이나 로그에 기록하지 않습니다.
issuer/audience/키/Origin 설정 오류가 있는 활성 구성은 기동에 실패합니다.
HTTPS Origin과 명시적인 HTTP localhost/127.0.0.1만 허용하며, 쿠키의 Secure를 자동으로 끄지 않습니다.
테스트에서 생성한 키는 실제 배포 키로 사용하지 않습니다.

**기능 비활성과 마이그레이션은 별개입니다.** DB에 연결해 기동하면 Flyway V2는 적용 대상입니다.
운영 DB 적용은 DB·인증 필수 리뷰와 별도 배포 승인을 받은 후 진행합니다. 기존 V1은 수정하지 않았습니다.

### 토큰·쿠키 및 재사용 처리

- Access는 RS256 JWT·900초이며 Auth는 서명·kid·issuer·audience·시간·필수 claim·역할을 확인합니다.
- Refresh는 32바이트 난수의 Base64URL 값이며 DB에는 SHA-256 해시만 저장합니다.
- rememberMe=false는 서버 1일/세션 쿠키, true는 서버 14일/지속 쿠키입니다.
  회전 후에도 최초 세션의 절대 만료를 유지합니다.
- 로컬 구현 쿠키 속성은 HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth, Domain 생략입니다.
  실제 브라우저·Gateway 환경에 대한 팀 확정값이라는 의미는 아닙니다.
- 로그인·재발급·로그아웃은 허용 Origin, 또는 Origin이 없을 때 Referer의 Origin을 확인합니다.
  둘 다 없거나 Origin이 null/불일치·중복이면 403 FORBIDDEN입니다.
- AUTH_ALLOWED_ORIGINS는 이 요청 출처 검증용이며 **CORS 응답을 자동 허용하는 설정이 아닙니다.**
  실제 교차 출처 CORS·credentials 설정은 Gateway/프론트와 별도 확정합니다.
- 현재 로컬 구현은 엄격한 회전안입니다. 같은 Refresh를 두 번 사용하면 한 요청만 성공하고,
  재사용이 감지된 로그인 세션의 활성 Refresh를 폐기합니다. 다른 로그인 세션은 유지합니다.
  정상 다중 탭 경합·응답 유실도 재로그인으로 이어질 수 있어 프론트의 추가 확인이 필요합니다.
- Refresh 401은 UNAUTHORIZED로 통일하며 Set-Cookie를 보내지 않습니다.
  세분화된 오류 코드는 #112의 제안 상태로 유지합니다.
- 로그아웃은 현재 세션만 폐기합니다. 발급된 Access가 즉시 전역 무효화되지는 않습니다.
  같은 브라우저 탭 간의 로그인·재발급·로그아웃 조정은 실제 프론트 연동에서 검증해야 합니다.

### 로컬 검증과 남은 작업

Java 21·기존 Wrapper로 spotlessCheck/test/build를 실행합니다.
실제 DB 테스트는 기존 AUTH_DB_TEST_URL/USERNAME/PASSWORD 방식을 사용하며,
URL은 localhost 또는 127.0.0.1의 **auth_registration_test** DB만 허용합니다.
허용된 테스트 DB의 데이터를 초기화하므로 전용 일회용 DB만 지정합니다.
DB 환경 변수가 없으면 실제 PostgreSQL 테스트 23개는 생략되며 DB 검증 성공으로 표시하지 않습니다.

테스트는 메모리/임시 디렉터리에서 키를 생성하고 실제 로컬 임의 포트 HTTP 서버로 검증합니다.
JWKS HTTP 응답의 공개키로 발급 토큰을 검증하며, 키 위조·HMAC 전환·만료·잘못된 claim·입력·출처도 검사합니다.
DB 검증은 동시 회전/로그아웃, 재사용 폐기의 commit, 저장 실패 rollback, 다른 세션 보존을 포함합니다.

아직 실제 HTTPS 브라우저 쿠키·CORS·Gateway JWT/신원 전달·우회 차단·다른 서비스 인가를 검증하지 않았습니다.
다중 탭 세부 정책·배포 Cookie/Origin·JWKS 운영 주소·키 교체와 만료 Refresh 이력 정리도 후속 확인 대상입니다.
이 코드 추가는 #112 A안 확정·관리자 차단 해제·배포 승인을 뜻하지 않습니다.

## 회원정보·비밀번호 변경 — Issue #215

이 브랜치의 로컬 구현이며 main/dev 배포 기능으로 표시하지 않는다. 프론트의 핵심 설계 COMMENT를 반영했으며 최종 코드 리뷰·CI·병합은 별도다. [설계 및 검증 기록](../../docs/api/auth-profile-password-proposal.md)을 기준으로 한다.

| API                            | 요청                                             | 결과                                               |
| ------------------------------ | ------------------------------------------------ | -------------------------------------------------- |
| PATCH /api/v1/auth/me          | Bearer Access 및 `{nickname}`                    | 200, 기존 AU-02와 동일한 회원정보                  |
| PATCH /api/v1/auth/me/password | Bearer Access 및 `{currentPassword,newPassword}` | 204, 본인 전체 Refresh 폐기·현재 Refresh 쿠키 삭제 |

두 API는 현재 ACTIVE/CUSTOMER 계정만 허용한다. nickname은 1~50 코드 포인트이고 null·공백만인 값은 거절하며 앞뒤 공백을 변경하지 않는다. AU-02에서 기존 미설정 nickname=null을 반환하는 동작은 유지한다. 이메일·ID·역할·상태·타인 계정 지정 필드는 받지 않는다.

새 비밀번호는 기존 가입 설정(개발 기본 12~64)을 재사용하고 입력 문자를 그대로 해시한다. 현재 비밀번호 불일치는 400 CURRENT_PASSWORD_MISMATCH, 잘못된 Access는 401 UNAUTHORIZED, 권한 부족은 403 FORBIDDEN이다. 실패에는 쿠키를 삭제하지 않는다. 이미 발급된 Access는 기존 만료까지 유효할 수 있으며 전체 Refresh 폐기를 즉시 전역 Access 폐기로 안내하지 않는다.

비밀번호 변경 204 이후 프론트는 JSON 파싱이나 /logout 추가 호출 없이 로컬 인증 상태와 진행 중 세션 요청을 무효화하고 재로그인을 안내한다. 현재 화면/장바구니 보존과 계정 전환 방어는 기존 프론트 정책을 따른다. 프론트 코드는 이 변경에 포함하지 않는다.

로컬 Java 21·Spotless·Gradle test/build 및 JUnit 162개(실제 PostgreSQL 23개) 통과, 실패·오류·생략 0이다. 기존 134개를 유지하고 새 경계/원자성/경합 테스트 28개를 추가했다. GitHub의 DB 환경 변수가 없는 실행에서는 기존 DB 테스트 생략 정책이 적용되며 로컬 DB 검증 결과와 구분한다.
