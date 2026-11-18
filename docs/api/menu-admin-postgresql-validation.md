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
