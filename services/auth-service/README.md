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
회원가입과 이메일 중복 확인 API를 OpenAPI에 제공합니다. 로그인·JWT·Refresh Token 기능은 후속 Issue 범위입니다.

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
