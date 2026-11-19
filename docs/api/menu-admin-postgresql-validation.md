# Issue #108 PostgreSQL 16 실제 조회 검증

검증일: 2026-11-18 (Asia/Seoul). 브랜치 feat/108-menu-admin-query, HEAD fb142b9.
origin/main은 2847b18이며 브랜치 전환·merge·reset·stash·Commit·Push를 수행하지 않았습니다.

## 격리 환경

- Docker CLI/서비스는 설치되어 있지 않았고 기존 postgresql-x64-18 서비스가 실행 중이었습니다.
- 기존 PostgreSQL 18 서비스와 데이터 디렉터리·설정·DB·역할은 변경하지 않았습니다.
- [PostgreSQL 공식 Windows 다운로드 안내](https://www.postgresql.org/download/windows/)에서 연결하는
  [EDB 바이너리 ZIP](https://productsdl.enterprisedb.com/download-postgresql-binaries)의 PostgreSQL 16.16 Windows x64를 사용했습니다.
- 실제 다운로드: `https://get.enterprisedb.com/postgresql/postgresql-16.16-1-windows-x64-binaries.zip`
- 다운로드 파일의 로컬 SHA-256: `5c0d06f3d26a929ecb36dd931409f1e51a4181355794a259b90aae8bffc57a9f`.
  이는 재현용 로컬 해시 기록이며 공급자가 별도 게시한 해시와 비교했다는 의미는 아닙니다.
- TEMP 아래 새 전용 폴더에서 initdb로 UTF8/C locale 클러스터를 만들었습니다. Windows 서비스 등록은 하지 않았습니다.
- 전용 데이터 디렉터리, `127.0.0.1:60637`, `menu_108_isolated` DB, `menu108_owner` 역할을 사용했습니다.
  localhost의 다른 포트나 공유 menu_dev에는 연결하지 않았습니다.
- 임시로 생성한 비밀번호를 사용하고 환경 변수로 테스트 프로세스에만 전달했습니다. 비밀번호를 Git·로그·문서에 기록하지 않았습니다.
- 실제 서버 확인: PostgreSQL 16.16, current_database=menu_108_isolated, inet_server_addr=127.0.0.1, inet_server_port=60637.

최초 initdb 호출은 PowerShell 인자 전달 형식 오류로 서버 생성 전에 실패했습니다.
`--pwfile`과 경로를 분리해 수정한 뒤 정상 초기화했습니다. 애플리케이션 코드·마이그레이션 수정은 필요하지 않았습니다.

## 실행과 실제 결과

전용 DB를 생성한 뒤 MENU_DB_TEST_URL/USERNAME/PASSWORD를 해당 환경에만 지정하고 실행했습니다.

```powershell
# services/menu-service, Java 21
# MENU_DB_TEST_*는 준비한 별도 폐기용 DB를 가리켜야 합니다.
.\gradlew.bat spotlessApply spotlessCheck test build --rerun-tasks
git diff --check
```

`--rerun-tasks`로 이전의 DB 비활성 테스트 결과가 UP-TO-DATE 처리되지 않도록 했습니다.
비밀번호 환경 변수는 실행 뒤 해제했습니다.

| 검사 | 실제 실행 | 통과 | 실패/오류 | 생략 |
| --- | --- | --- | --- | --- |
| 기존 MenuDatabaseTests | 35 | 35 | 0 | 0 |
| 신규 AdminMenuQueryDatabaseTests | 13 | 13 | 0 | 0 |
| 기존 단위·DTO·HTTP·권한 경계 검사 | 169 | 169 | 0 | 0 |
| 전체 | 217 | 217 | 0 | 0 |

기존에 DB 미설정 상태에서 생략된 **9건은 테스트 메서드 수**입니다.
실제 DB 활성화 시 @EnumSource/@CsvSource/@ValueSource의 개별 사례가 확장되어 35건 실행됩니다.

Flyway는 기존 `V1__create_menu_tables.sql`을 새 DB에 적용했습니다.
이후 flyway_schema_history 조회에서 version=1, description=create menu tables, success=true를 확인했습니다.
기존 DB 테스트의 제약·관계·상태·가격/조리시간 검사는 모두 통과했습니다.

신규 13건은 mock 없이 실제 EntityManager·Repository·Service를 사용합니다.

- 관리자 목록 JPQL이 ON_SALE·PAUSED·HIDDEN 모두를 반환하고 category를 join fetch하는지 확인.
- 세 상태의 상세 JPQL·Service 응답, HIDDEN 허용, 시각·nullable 필드·빈 옵션 확인.
- 옵션 JPQL의 ID ASC, 활성/비활성·기본값·추가 조리시간, 타 메뉴 옵션 제외 확인.
- 실제 저장한 행으로 기본 카테고리 순서·가격순과 동률 메뉴 ID 정렬 확인.
- 카테고리/앞뒤 공백 제거·대소문자 무시 이름 검색/상태의 복합 필터, `%_` 리터럴 검색 확인.
- 상태별 필터, 미일치 검색·없는 카테고리·빈 DB·미존재 상세의 MENU_NOT_FOUND 확인.

테스트 데이터 변경은 @Transactional로 각 테스트 종료 시 롤백됩니다.
전체 실행 후 별도 SQL로 categories=0, menus=0, menu_options=0을 확인했습니다.
Flyway 스키마·이력만 격리 DB에 남았고 JPQL·조회 구현의 결함은 발견되지 않았습니다.
실제 XML 결과는 `services/menu-service/build/test-results/test/TEST-*.xml`이며 HTML 보고서는
`services/menu-service/build/reports/tests/test/index.html`에 있습니다.

## 종료 및 범위

검증 후 해당 임시 data 디렉터리만 지정해 pg_ctl stop을 수행했습니다.
전용 포트 리스너가 사라졌고 기존 postgresql-x64-18 서비스는 계속 Running임을 확인했습니다.
이번에 만든 임시 비밀번호 파일을 제거했으며 기존 로컬 작업·bin/ 파일은 보존했습니다.
임시 바이너리·데이터·기존 변경 백업은 TEMP의 peakorder-108-pg16-* 전용 폴더에 남아 있습니다.

제품 Service·Repository·Entity·Flyway·의존성·인증 차단 구현은 이번 검증에서 수정하지 않았습니다.
추가 파일은 실제 DB 테스트와 이 검증 기록이며 README·기존 작업 문서의 미검증 표시를 갱신했습니다.

PR #105는 미병합이며 해당 고객 API를 복사하거나 통합하지 않았습니다.
따라서 고객 API 통합 후 회귀와 실제 Auth/Gateway 인증 연동 완료를 의미하지 않습니다.
Issue #108에는 담당자에게 계약 확인 요청만 있고 답변이 없어 기본 403 차단을 유지합니다.
추후 연결 지점은 AdminMenuAuthorization.requireStoreAdmin()이며 실제 검증 체계가 합의되기 전에는 허용 경로를 추가하지 않습니다.

## 2026-11-19 최신 main 통합 후 재검증

- `git fetch origin` 후 `origin/main`은 `f12a50c107ca6dffb19b9c3b80247998e03b8feb`입니다.
- 추적 파일 변경 및 전환 대상과 겹치는 미추적 파일이 없음을 확인하고 기존 #108 브랜치로 전환했습니다.
- 전환 직후 HEAD는 WIP `242765d20cedc50471820623186bbe14bcdfac66`이며 작업 파일 차이는 없었습니다.
- merge-base 이후 main의 6개 커밋은 CLAUDE.md와 Order/Cooking 84개 파일에 해당하며 Menu 구현과 경로 중복이 없었습니다.
- `git merge-tree --write-tree` 사전 검사 및 `git merge --no-edit origin/main` 모두 충돌 없이 성공했습니다.
- 결과 HEAD는 `c21a17b7d69b3c51538857d6b34e4e488c75fcaa`입니다. 부모는 `242765d`, `f12a50c`입니다.
- Menu 구현·테스트·기존 API 문서는 WIP 대비 동일합니다. 이번 재검증에서 이 기록만 추가 수정했습니다.
- #105는 조회 시 open/unmerged였습니다. 해당 HEAD `f274b20`은 통합 HEAD의 조상이 아니며 코드를 복사하지 않았습니다.

### 환경과 실제 실행 결과

기존 임시 PostgreSQL 16.16 바이너리를 재사용하되 TEMP 아래 **새 데이터 디렉터리**를 initdb로 생성했습니다.
전용 주소는 `127.0.0.1:62962`, DB는 `menu_108_revalidation`, 역할은 `menu108_owner`입니다.
임시 비밀번호는 실행 프로세스에만 주입했으며 초기화용 파일은 제거했습니다.
공유 DB와 기존 PostgreSQL 18 서비스·설정·데이터 디렉터리는 변경하지 않았습니다.

Java 21.0.7에서 Menu Service의 아래 명령을 실행했습니다.

```powershell
.\gradlew.bat spotlessCheck test build --rerun-tasks --console=plain
git diff --check
git diff origin/main...HEAD --check
```

| 테스트 클래스 | 실제 실행/통과 | 실패·오류·생략 |
| --- | --- | --- |
| AdminMenuAuthorizationBoundaryTests | 2 | 0 |
| AdminMenuHttpTests | 45 | 0 |
| AdminMenuQueryDatabaseTests | 13 | 0 |
| AdminMenuDtoTests | 2 | 0 |
| MenuDatabaseTests | 35 | 0 |
| MenuServiceApplicationTests | 54 | 0 |
| AdminMenuQueryServiceTests | 34 | 0 |
| MenuExistenceServiceTests | 9 | 0 |
| PurchaseValidationServiceTests | 23 | 0 |
| **합계** | **217** | **0** |

Gradle은 10개 task를 실제 실행하고 BUILD SUCCESSFUL로 종료했습니다. XML 결과를 합산했으며 PostgreSQL 48건도 생략되지 않았습니다.
최초 실행 도구가 JVM CDS 경고(stderr)를 PowerShell 오류로 취급해 중단되어 해당 격리 서버를 종료했습니다.
도구의 경고 처리만 수정하고 새 클러스터에서 위 전체 검증을 다시 실행한 결과입니다. 제품 코드 수정은 없었습니다.
Flyway V1 성공과 검증 후 categories/menus/menu_options 각 0행을 확인했습니다. 테스트용 서버 종료 및 포트 리스너 소멸도 확인했습니다.

ME-03 검색·필터·정렬, 세 판매 상태, ME-04 상세·활성/비활성 옵션, 잘못된 요청·미존재·내부 오류,
DTO·OpenAPI, 실제 Repository/Service와 모의 권한 HTTP, 기존 MI-01·MI-02 회귀가 통과했습니다.
실제 AdminMenuAuthorization의 기본 403 차단과 위조 헤더/JWT/Servlet 신원 거부는 유지됩니다.
실제 STORE_ADMIN 200·비회원 401·CUSTOMER 403 연동은 #112 공통 계약 미확정으로 미완료입니다.
#105의 ME-01·ME-02 통합 회귀도 미실행입니다. 따라서 인증을 제외해도 Issue 전체 완료 조건을 모두 충족한 상태는 아닙니다.
미완료 사항을 명시한 Draft PR 검토 자료로는 사용할 수 있지만 이번에는 Push·PR 생성·PR 병합을 수행하지 않았습니다.

### 기존 파일 보존 점검과 예외

#110 로컬 브랜치는 `7ce078d`로 유지됐고 기존 백업 파일은 수정하지 않았습니다.
작업 시작 시 bin 106개 파일의 SHA-256을 기록했습니다. 마지막 점검에서 삭제 0개, 기존 파일 변경 5개, 신규 파일 11개를 확인했습니다.
변경·추가는 모두 Order bin이며 Inventory/Payment의 기존 bin 파일 해시는 일치했습니다.
변경된 5개는 application.yml, RestClientConfig.class, ErrorCode.class, OrderService.class, OrderServiceTest.class입니다.
신규 파일은 main에서 추가된 CookingHealthClient/HttpCookingHealthClient/SchedulingConfig/CookingAvailability/CookingHealthChecker 및 관련 테스트 class입니다.
VS Code Java 언어 서버가 실행 중이며 Order bin 갱신 시각은 브랜치 전환·통합 직후였습니다. IDE 자동 빌드가 의심되지만 쓰기 프로세스를 직접 확인하지는 못했습니다.
bin을 편집·삭제·복구하는 명령이나 Order 빌드는 실행하지 않았습니다. 원본과 동일하다고 보고하지 않으며 임의 복구도 하지 않았습니다.
변경된 5개의 작업 시작 해시는 기존 bin-backup.zip의 해당 파일과 일치하지 않아 그 백업으로 이번 시작 상태를 정확히 복원할 수 있다고 주장하지 않습니다.
기존 백업 자체는 보존됐으며 조회 전후 해시 변화도 없었습니다.
해시 기준·실행 스크립트·DB 확인·Gradle 로그는 TEMP의 `peak108-verify-0c28d1ecd81744fbaa6a1bf0c008914c`에 남겼습니다.

## 2026-11-19 Draft PR 제출 전 최신 main 확인

추가 fetch에서 main의 `0d4c54f`(Cooking OrderConfirmed 처리, 9개 파일)를 확인했습니다.
Menu 소스·테스트·설정·의존성과 겹치지 않았고 merge-tree 검사 후 충돌 없이 merge했습니다.
통합 커밋은 `a538203e02430ba18546a38d79fd331b4e999633`이며 Menu 구현은 `c21a17b` 대비 동일합니다.

제출 전 새 격리 PostgreSQL 16.16 클러스터(`127.0.0.1:51397`, `menu_108_revalidation`)에서
Java 21.0.7로 `spotlessCheck test build --rerun-tasks --console=plain`을 다시 실행했습니다.
XML 합산 결과 **217건 통과, 실패·오류·생략 0건**이며 위 표의 클래스별 건수와 같습니다.
실제 PostgreSQL 48건(기존 DB 35건, 관리자 DB 13건), MI-01·MI-02 회귀, DTO/OpenAPI/HTTP·기본 인증 차단 검사를 포함합니다.
Flyway V1 성공 및 검증 후 세 업무 테이블 각 0행을 확인하고 임시 서버를 종료했습니다.

이번 작업 시작 기준 bin 117개와 기존 백업 4개, 총 121개 파일을 해시로 대조해 변경·삭제 0건을 확인했습니다.
앞 절의 Order bin 5개 변경·11개 추가는 이전 단계의 관찰 기록이며 원인을 확정하거나 이번에 복구하지 않았습니다.
WIP `242765d`와 #110 브랜치 `7ce078d`를 유지하며 bin·백업은 스테이징하지 않습니다.
main 대상 전체 diff는 관리자 Menu 소스·테스트·README 및 API/검증 문서 19개 파일입니다.
다른 서비스·생성 파일·의존성·Flyway 변경은 PR diff에 포함하지 않습니다.

#112는 검토용 제안 상태이며 기본 차단은 유지됩니다. 실제 STORE_ADMIN 200·비회원 401·CUSTOMER 403은 미검증입니다.
#105도 조회 시 미병합이므로 고객 API 통합 회귀는 미완료입니다. 이 상태를 명시한 Draft PR만 제출하며 Issue 종료·리뷰 요청·승인·병합은 하지 않습니다.
이번 실행의 해시 기준·스크립트·로그·XML 사본은 TEMP의 `peak108-draft-6f46e449e08741d88fd45c6b971889fc`에 보존했습니다.
