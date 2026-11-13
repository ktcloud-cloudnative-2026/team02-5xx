# Menu Service

피크오더 Menu Service의 독립 Spring Boot 프로젝트입니다. 담당: 이은제 (@MyaNiss).
개발 규칙은 저장소 루트의 [CLAUDE.md](../../CLAUDE.md)를 따릅니다.

## 개발 환경

| 항목 | 버전 / 값 |
| --- | --- |
| Java | 21 |
| Spring Boot | 4.1.2 |
| Gradle Wrapper | 8.14.3 (Groovy DSL) |
| Gradle group | `com.peakorder` |
| 기본 패키지 | `com.peakorder.menu` |
| springdoc-openapi | 3.2.0 |
| Spotless | 7.2.1 |
| Google Java Format | 1.28.0 |

Java 21 JDK를 설치하고 `JAVA_HOME` 또는 `PATH`로 지정합니다.
Spotless 7.2.1과 Google Java Format 1.28.0은 Java 21 / Gradle 8.14.3에서 사용하도록 고정했습니다.
Spring Boot BOM으로 기본 의존성 버전을 관리합니다.
최초 실행 시 Gradle 공식 배포 서버, Gradle Plugin Portal 및 Maven Central에 접근해야 합니다.

## 빌드 · 테스트 · 실행

아래 명령은 `services/menu-service`에서 실행합니다 (PowerShell).

```powershell
.\gradlew.bat --version
.\gradlew.bat spotlessApply
.\gradlew.bat clean build
.\gradlew.bat test
.\gradlew.bat spotlessCheck
.\gradlew.bat bootRun
```

macOS/Linux에서는 `.\gradlew.bat` 대신 `sh ./gradlew`를 사용합니다.
`build`는 테스트와 Spotless 검사를 포함합니다.
테스트 결과는 `build/reports/tests/test/index.html`에서 확인합니다.
실행은 `Ctrl+C`로 종료합니다.

기본 포트는 Spring Boot 기본값인 8080이며, `SERVER_PORT` 환경 변수로 변경할 수 있습니다.
실행 가능한 JAR로도 구동할 수 있습니다.

```powershell
java -jar build/libs/menu-service-0.0.1-SNAPSHOT.jar
```

## API 문서

- Swagger UI: http://localhost:8080/swagger-ui.html (`/swagger-ui/index.html`로 이동)
- OpenAPI JSON: http://localhost:8080/v3/api-docs
- Swagger UI 설정: http://localhost:8080/v3/api-docs/swagger-config

업무 API가 없는 초기 프로젝트이므로 OpenAPI의 `paths`는 비어 있습니다.
통합 테스트는 임의 포트에서 애플리케이션을 시작해 OpenAPI JSON, Swagger UI HTML·JavaScript 및 문서 연결 설정을 실제 HTTP 요청으로 검증합니다.

## 패키지 구조와 작업 범위

애플리케이션 진입점은 `com.peakorder.menu.MenuServiceApplication`입니다.
업무 구현 시 기본 패키지 아래에 `controller`, `service`, `repository`, `dto`, `entity` 계층을 추가합니다.
현재 사용하지 않는 패키지에는 예시 클래스나 설명용 파일을 만들지 않습니다.
DB, Redis, RabbitMQ, Docker, Kubernetes 및 업무 API는 이번 초기화 범위에 포함하지 않습니다.
서비스 전용 `.editorconfig`와 `.gitattributes`를 사용합니다.

## Gradle 배포본 검증

공식 배포본: https://services.gradle.org/distributions/gradle-8.14.3-bin.zip

공식 SHA-256: https://services.gradle.org/distributions/gradle-8.14.3-bin.zip.sha256

```text
bd71102213493060956ec229d946beee57158dbd89d0e62b91bca0fa2c5f3531
```

Wrapper는 공식 배포 ZIP의 SHA-256을 검증한 Gradle 8.14.3으로 생성했습니다.
`gradle/wrapper/gradle-wrapper.properties`의 `distributionSha256Sum`에 위 값을 고정하여 Wrapper의 최초 배포본 다운로드에서도 검증합니다.
Wrapper JAR은 https://services.gradle.org/distributions/gradle-8.14.3-wrapper.jar.sha256 과 비교해 검증합니다.

검증한 Wrapper JAR SHA-256:

```text
7d3a4ac4de1c32b59bc6a4eb8ecb8e612ccd0cf1ae1e99f66902da64df296172
```
