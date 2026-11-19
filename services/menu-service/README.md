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
애플리케이션 실행 전에는 아래 DB 설정이 필요합니다.

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

ME-01 `GET /api/v1/menus`, ME-02 `GET /api/v1/menus/{menuId}`는 비회원 고객의
메뉴 목록·상세 조회를 제공합니다. 필터·정렬·상태·옵션 및 오류 계약은
[ME-01·ME-02 상세 명세](../../docs/api/menu-me01-me02.md)를 확인합니다.
ON_SALE·PAUSED를 조회할 수 있고 HIDDEN은 노출하지 않습니다.

- Swagger UI: http://localhost:8080/swagger-ui.html (`/swagger-ui/index.html`로 이동)
- OpenAPI JSON: http://localhost:8080/v3/api-docs
- Swagger UI 설정: http://localhost:8080/v3/api-docs/swagger-config

MI-01 `POST /internal/v1/menus/validate-purchase`를 구현했습니다.
Order·Cooking 요청 계약과 오류 매핑은 [MI-01 구현 명세](../../docs/api/menu-mi01.md)를 확인합니다.

MI-02 `GET /internal/v1/menus/{menuId}/existence`를 제공합니다.
응답·오류·역할 구분은 [MI-02 구현 명세](../../docs/api/menu-mi02.md)를 확인합니다.
ON_SALE·PAUSED·HIDDEN은 모두 exists=true이며 신규/기존 연결 정책은 Inventory 책임입니다.
미존재 응답은 제안된 `exists=false, status=null`로 구현했고 status 필드는 생략하지 않습니다.
문서 테스트는 DB 자동 설정을 제외하고 임의 포트에서 애플리케이션을 시작해 OpenAPI JSON, Swagger UI HTML·JavaScript 및 문서 연결 설정을 실제 HTTP 요청으로 검증합니다.

## PostgreSQL 실행 및 설정

PostgreSQL 16 서버를 실행하고 `bin` 디렉터리를 PATH에 추가합니다.
Menu Service 전용 사용자와 독립 DB를 준비합니다. 아래는 로컬 개발용 예시이며,
`createuser -P`의 프롬프트에서 비밀번호를 입력합니다. 관리자 인증도 프롬프트 또는 승인된 비밀정보 저장 수단을 사용합니다.

```powershell
createuser -h localhost -U postgres -P menu_app
createdb -h localhost -U postgres -O menu_app menu_dev
createdb -h localhost -U postgres -O menu_app menu_test

$dbCredential = Get-Credential -UserName menu_app -Message 'Menu DB 접속 정보'
$env:MENU_DB_URL = 'jdbc:postgresql://localhost:5432/menu_dev'
$env:MENU_DB_USERNAME = $dbCredential.UserName
$env:MENU_DB_PASSWORD = $dbCredential.GetNetworkCredential().Password
.\gradlew.bat bootRun
```

| 환경 변수 | 용도 |
| --- | --- |
| `MENU_DB_URL` | Menu Service 전용 PostgreSQL JDBC URL |
| `MENU_DB_USERNAME` | DB 접속 사용자 |
| `MENU_DB_PASSWORD` | DB 접속 비밀번호 |

접속 정보는 환경 변수로 주입하며 코드나 Git에 저장하지 않습니다.
테이블은 시작 시 Flyway가 `src/main/resources/db/migration`에서 생성합니다.
Hibernate는 `ddl-auto=validate`로 매핑만 검증합니다. 테이블 DDL을 수동 실행하거나
`ddl-auto=create/update`로 변경하지 않고, 후속 변경은 새 버전의 Flyway 파일로 추가합니다.

### 초기 스키마

기준은 [현행 메뉴 ERD 3-3](../../docs/erd/notion-draft.md)입니다.
`V1__create_menu_tables.sql`은 `categories`, `menus`, `menu_options`만 생성합니다.

- PK는 `BIGINT` identity이며, 필수 관계 `menus.category_id`, `menu_options.menu_id`에 FK와 인덱스를 둡니다. 참조 중인 부모의 물리 삭제는 FK로 차단합니다.
- 메뉴 상태는 문자열 `ON_SALE`, `PAUSED`, `HIDDEN`만 허용합니다. 논리 삭제는 `HIDDEN`으로 표현하며 품절·재고는 저장하지 않습니다.
- 기본/추가 가격과 기본/추가 조리시간은 NOT NULL 및 0 이상 CHECK로 보호합니다.
- 설명과 이미지 주소는 선택 필드이고, 나머지 필드는 NOT NULL입니다. ERD에 길이가 없는 varchar는 기본 255자, 상태는 20자로 매핑합니다.
- `sort_order` 기본값은 0, `is_default`는 false, `active`는 true입니다. 메뉴 생성 시각은 DB 기본값과 JPA 생명주기로 기록하며, JPA 수정 시 `updated_at`을 갱신합니다.
- JPA 관계는 지연 로딩하는 단방향 ManyToOne이며 자동 연쇄 삭제는 없습니다.

### DB 통합 테스트

반드시 폐기 가능한 **별도 테스트 DB**를 사용합니다. 테스트 시작 시 Flyway가 적용되고,
각 테스트의 데이터 변경은 트랜잭션 종료 시 롤백됩니다. Flyway 스키마와 이력은 유지됩니다.
위에서 만든 `menu_test`를 사용하는 예시는 다음과 같습니다.

```powershell
$env:MENU_DB_TEST_URL = 'jdbc:postgresql://localhost:5432/menu_test'
$env:MENU_DB_TEST_USERNAME = $dbCredential.UserName
$env:MENU_DB_TEST_PASSWORD = $dbCredential.GetNetworkCredential().Password
.\gradlew.bat spotlessCheck test build --rerun-tasks
```

`MenuDatabaseTests`는 Flyway 이력·검증, 인덱스, 세 Repository의 저장·조회·관계,
허용 상태와 0 경계값, PK·FK·NOT NULL·가격/조리시간/상태 CHECK를 실제 PostgreSQL에서 검증합니다.
`MENU_DB_TEST_URL`이 없거나 PostgreSQL JDBC URL이 아니면 DB 테스트는 건너뜁니다.
이 경우 문서 테스트와 빌드가 성공해도 DB 검증 성공을 의미하지 않습니다.
접속 정보를 설정한 상태에서 DB 연결이나 마이그레이션이 실패하면 테스트도 실패합니다.
결과와 건너뜀 여부는 `build/reports/tests/test/index.html`에서 확인합니다.

## 패키지 구조와 작업 범위

애플리케이션 진입점은 `com.peakorder.menu.MenuServiceApplication`입니다.
업무 구현 시 기본 패키지 아래에 `controller`, `service`, `repository`, `dto`, `entity` 계층을 추가합니다.
기존 `entity`, `repository`의 메뉴 DB 모델과 저장소를 재사용하며,
`controller`, `service`, `dto`, `exception`에 MI-01 구매 검증·MI-02 존재 확인과 ME-01·ME-02 고객 조회 API를 구현했습니다.
현재 사용하지 않는 패키지에는 예시 클래스나 설명용 파일을 만들지 않습니다.
Redis, RabbitMQ, Docker, Kubernetes는 이번 구현 범위에 포함하지 않습니다.
서비스 전용 `.editorconfig`와 `.gitattributes`를 사용합니다.
DB 구조 및 마이그레이션 변경은 팀 규칙상 작성자 외 팀원 1명의 필수 리뷰 대상입니다.

## ME-01·ME-02 검증

Java 21에서 `spotlessCheck test build`를 검증했습니다.
고객 조회 Service 21건·실제 HTTP 35건 및 기존 MI-01·MI-02 회귀 78건을 합해 134건 통과했습니다.
실제 PostgreSQL 테스트 10건은 별도 테스트 DB 미설정으로 건너뛰었습니다.
공유 DB·Gateway·React·실제 Inventory 연동은 검증하지 않았습니다.
카테고리 동시 조회와 옵션 정렬의 DB 테스트는 별도 폐기 가능한 PostgreSQL에서 실행해야 합니다.
상세 계약과 검증 범위는 [ME-01·ME-02 명세](../../docs/api/menu-me01-me02.md)를 확인합니다.

## MI-02 검증

```powershell
.\gradlew.bat spotlessCheck test build
```

Service 단위 테스트 및 Repository를 모의 실행하는 실제 HTTP/OpenAPI 테스트로
상태 3종, 미존재, 잘못된 ID, DB·서비스 오류와 공통 응답 직렬화를 검증합니다.
잘못된 ID는 HTTP 400 / INVALID_REQUEST, DB·내부 장애는 HTTP 500 / INTERNAL_ERROR입니다.
기존 MenuDatabaseTests는 MENU_DB_TEST_URL이 없으면 건너뜁니다.
공유 menu_dev에서 테스트하거나 Flyway를 재적용하지 않습니다.
PostgreSQL·실제 Inventory 연동은 별도 검증 대상이며 Notion은 이번 작업에서 갱신하지 않습니다.
서비스 간 API 계약이므로 추후 PR은 작성자 외 팀원 1명 승인과 CI 통과가 필요합니다.

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

## MI-01 로컬 회귀 검증

```powershell
.\gradlew.bat spotlessApply spotlessCheck test build
```

Service 단위 테스트와 실제 HTTP/OpenAPI 테스트는 Repository 모의 구현을 사용합니다.
기존 `MenuDatabaseTests`는 `MENU_DB_TEST_URL`이 없으면 건너뜁니다.
공유 `menu_dev`로 테스트를 실행하지 않습니다.
MI-01 세부 오류 코드/HTTP 상태 구분은 아직 서비스 간 합의가 필요합니다.
현재는 기존 `INVALID_REQUEST`/`INTERNAL_ERROR`를 재사용하며 전용 코드를 추가하지 않았습니다.
