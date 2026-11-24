# Menu 관리자 API 통합·PostgreSQL 검증 — #245

## 기준 및 재사용

- 기준 main: `eac2e88c7da2ed894689d4868713467c975ee3f4` (#240 병합 포함).
- 통합 브랜치: `feat/245-menu-admin-api-integration`. 기존 Worktree에서 생성했으며 Merge·Cherry-pick으로 과거 브랜치 전체를 합치지 않았다.
- #117 `b877a3fb`: ME-03·04 Controller/DTO/읽기 Repository/Service 및 기존 테스트.
- #119 `1836d171`: ME-05 엄격한 JSON/값 검증, 메뉴·옵션 원자 저장·롤백 및 테스트.
- #123 `1e685100`: ME-06 presence/null 구분, 옵션별 upsert, 부모 행 PESSIMISTIC_WRITE·트랜잭션 및 테스트.
- #127 `6ba46378`: ME-07 `/status`, 세 상태 전이·동일 상태 무변경·좁은 원자 SQL 및 테스트.
- 공통 인증·오류 advice·README·DB 없는 HTTP 테스트의 Repository Mock만 통합에 맞게 정리했다. 고객 조회 EntityGraph를 보존하고 정보 변경용 Entity 메서드와 잠금 조회를 결합했다.
- Flyway V1·스키마·의존성·다른 서비스·인프라·프론트는 변경하지 않았다. 원래 Draft의 세부 계약은 기존 문서에 유지하며 임의의 신규 계약으로 확정하지 않는다.

## 이번 통합 코드 실행 결과 (2026-11-23)

Java 21, Gradle wrapper 8.14.3, 격리 PostgreSQL 18에서 다음을 실행했다.

```powershell
.\gradlew.bat --no-daemon spotlessApply test build --console=plain
```

JUnit XML 합산: **530 PASS, 실패 0, 오류 0, 생략 0**. 과거 Draft의 PASS 수를 합친 값이 아니다.
실제 PostgreSQL 테스트 **91건은 530건에 포함**된다.

| 클래스                            | 실제 DB 통과 |
| --------------------------------- | -----------: |
| MenuDatabaseTests                 |           36 |
| AdminMenuQueryDatabaseTests       |           13 |
| AdminMenuCreateDatabaseTests      |            6 |
| MenuUpdateDatabaseTests           |           12 |
| MenuStatusDatabaseTests           |           18 |
| AdminMenuIntegrationDatabaseTests |            6 |
| 합계                              |           91 |

- 기존 ME-03~07 정상·오류·엄격한 DTO/JSON·HTTP/OpenAPI와 기본 차단 테스트를 공통 정책으로 실행했다.
- 새 공통 정책 테스트는 신뢰 판정 후 ID/역할 누락·형식·범위·중복, CUSTOMER 403, 관리자 허용 및 실제 기본 차단을 검증한다.
- 새 HTTP+DB 통합 테스트는 등록→목록/상세→옵션 수정/추가/기존 옵션 보존→HIDDEN 변경→고객 목록/상세 및 MI-01·02 반영을 확인한다. 다섯 관리자 operation의 공통 401/403/기본 차단도 확인한다.
- 동시성 테스트는 실제 ME-06 Service와 ME-07 Service를 양쪽 순서로 실행하고 PostgreSQL Lock 대기·변경 보존을 검사한다. 과거 대표 SQL writer만으로 통합 검증을 대체하지 않는다.
- 기존 고객 ME-01·02 및 내부 MI-01·02 HTTP/Service, 실제 Repository·Flyway·DB 제약·트랜잭션 롤백 회귀를 포함한다.
- Spotless, Java 컴파일·실행 JAR build 및 변경 파일 공백 검사를 확인한다. 검증 산출물은 저장소 밖 `%TEMP%\peak-order-245`에 둔다.

## DB 격리와 한계

새 TEMP data 디렉터리·전용 역할/DB·loopback 임시 포트로 PostgreSQL을 시작했다. 기존 공유/개발 DB·클러스터·데이터 디렉터리는 사용하지 않았다.
Flyway V1 성공과 종료 시 업무 테이블 0행을 확인하고 임시 서버를 종료한다. 기존 PostgreSQL 16 배포 환경의 실제 dev 시험을 대체하지 않는다.

관리자 성공 HTTP는 **테스트에서 Gateway 신뢰 판정만 모의**한 결과다. 제품 `AdminMenuGatewayTrust`는 항상 false이며 기본 403을 유지한다.
실제 JWT 검증·Gateway 전달·위조/직접 호출 차단·dev 공개 활성화는 [인증 경계 문서](menu-admin-auth-integration.md)의 후속 검증 항목이다.
원격 CI·외부 리뷰·실제 dev 성공을 주장하지 않으며 Commit·Push·PR 생성·Draft 종료·main 병합은 수행하지 않는다.
