# Auth Service

피크오더 Auth Service의 Spring Boot 초기 프로젝트입니다.
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
테스트 3개는 애플리케이션 컨텍스트 기동, OpenAPI JSON, Swagger UI HTML·JavaScript 응답을 검증합니다.
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
회원가입·로그인·JWT·사용자 데이터 저장은 후속 기능 Issue에서 진행합니다.

## 패키지 구성

애플리케이션 진입점은 `com.peakorder.auth.AuthServiceApplication`입니다.
팀의 계층형 패키지 기준은 기본 패키지 아래의 `controller`, `service`,
`repository`, `dto`, `entity`입니다.
초기 파일은 애플리케이션 진입점과 기동·문서 접근 검증을 중심으로 구성했습니다.
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
