# ME-07 관리자 메뉴 판매 상태 변경 — 제안 계약

> #245 integration: endpoint/DTO semantics below are preserved from the original Draft.
> Authentication and old validation counts below are historical; see [current shared policy](menu-admin-auth-integration.md) and [integrated verification](menu-admin-postgresql-validation.md).

기준: [Issue #124](https://github.com/ktcloud-cloudnative-2026/team02-5xx/issues/124),
[API 초안의 수정 후 Menu 표](notion-draft.md), [메뉴 ERD 3-3](../erd/notion-draft.md),
기존 MenuStatus 및 Flyway V1, [CLAUDE.md](../../CLAUDE.md).
허용 전이·재요청·성공 응답·오류 세부 형식은 **팀 확정 전 구현 제안**입니다.

## 요청과 상태 전이

`PATCH /api/v1/admin/menus/{menuId}/status`, `Content-Type: application/json`.
이전 `/sales-status`나 물리 DELETE 경로는 추가하지 않습니다.

```json
{ "status": "PAUSED" }
```

menuId는 양의 Long이며 status는 필수 JSON 문자열입니다.
`ON_SALE`, `PAUSED`, `HIDDEN`의 정확한 대문자만 허용합니다.
생략/null·소문자·앞뒤 공백·배열/숫자/boolean·추가 필드·중복 키·후행 JSON·잘못된 본문은 400입니다.
공통 Jackson 설정은 바꾸지 않고 이 경로 전용 reader/DTO로 엄격히 검증합니다.

| 현재 상태 → 요청 | ON_SALE     | PAUSED      | HIDDEN      |
| ---------------- | ----------- | ----------- | ----------- |
| ON_SALE          | 무변경 성공 | 변경        | 변경        |
| PAUSED           | 변경        | 무변경 성공 | 변경        |
| HIDDEN           | 복귀 허용   | 복귀 허용   | 무변경 성공 |

기존 모델에는 전이 제한·복구 금지 정보가 없으므로 세 상태 간 전이를 모두 허용하는 안을 선택했습니다.
HIDDEN은 물리 삭제가 아닌 비공개·논리 삭제 상태이며 복귀 시 기존 메뉴·옵션 ID를 그대로 유지합니다.
같은 상태를 재요청하면 200 성공이며 status·updatedAt 모두 변경하지 않습니다. 다른 필드도 그대로 유지합니다.
다른 상태로 실제 변경할 때만 updatedAt을 갱신합니다.
ON_SALE은 Menu의 판매 상태일 뿐 재고 확보·주문 가능 수량·품절 해소를 보장하지 않습니다.
Inventory DB/API·재고 자동 생성/연결·쓰기 이벤트는 추가하지 않습니다.

## 응답과 오류

성공 제안: **200 + menuId/status**, 예:

```json
{
  "success": true,
  "data": { "menuId": 123, "status": "PAUSED" },
  "message": "OK"
}
```

응답 status는 이 요청이 적용하거나 무변경 성공한 목표 상태입니다.
동시 요청이 뒤따르면 응답 수신 시점의 최신 DB 상태가 다를 수 있으며 최신 상태를 고정하는 버전 토큰은 아닙니다.

| 조건                             | HTTP / errorCode      |
| -------------------------------- | --------------------- |
| 실제 제품 HTTP 경로              | 403 / FORBIDDEN       |
| 권한 허용 후 잘못된 ID/JSON/상태 | 400 / INVALID_REQUEST |
| 미존재 메뉴                      | 404 / MENU_NOT_FOUND  |
| DB 및 그 외 내부 실패            | 500 / INTERNAL_ERROR  |

기존 ApiResponse·camelCase를 재사용하며 오류의 null data는 생략합니다.
응답·로그에 SQL·접속 정보·예외 원문·요청 본문을 노출하지 않습니다.
Swagger/OpenAPI는 상태 enum 필수값, 기본 차단·전이·무변경 정책과 200/400/403/404/500을 문서화합니다.

## 트랜잭션과 필드 보존

`MenuStatusService.change()`는 단일 `@Transactional`에서 전용 읽기/쓰기 Repository를 사용합니다.
기존 Menu Entity 매핑·MenuRepository 인터페이스·DB·Flyway·인덱스·의존성은 변경하지 않습니다.
메뉴를 조회하여 전체 Entity를 save하는 대신 아래 **상태/시각 두 컬럼만 쓰는 조건부 UPDATE**를 실행합니다.

```sql
UPDATE menus
SET status = :status,
    updated_at = GREATEST(clock_timestamp(), updated_at)
WHERE id = :id AND status <> :status;
```

PK로 한 행만 갱신합니다. 영향 행이 0개이면 기존 MenuRepository.existsById로 무변경 성공과 미존재를 구분합니다.
메뉴 ID·카테고리·이름·설명·이미지·가격·조리시간·createdAt과 모든 옵션 행은 쓰지 않습니다.
같은 상태는 UPDATE 대상에서 제외되어 수정 시각도 유지합니다.
Native bulk UPDATE는 Entity의 @PreUpdate를 실행하지 않으므로 실제 상태 변경의 updatedAt을 명시적으로 갱신합니다.
요청 시작 때 만든 Java 시각이나 PostgreSQL 트랜잭션 시작 시각 대신 DB 실시간 시각을 사용하며,
시계 차이나 미래의 기존 시각에도 updatedAt이 감소하지 않도록 GREATEST를 적용합니다.
기존 시각이 미래이면 실제 상태 변경에도 동일 시각을 유지할 수 있습니다.

DB 오류를 잡아 성공으로 바꾸지 않으며 RuntimeException은 서비스 트랜잭션을 롤백합니다.
Native bulk write는 영속성 컨텍스트의 기존 Menu 객체를 자동 갱신하지 않습니다.
현재 HTTP 경로는 상태 변경 전에 Menu 객체를 로드하지 않는 독립 트랜잭션입니다.
향후 같은 트랜잭션에서 다른 업무와 조합하면 기존 managed Menu를 refresh/clear하는 정책 또는 쓰기 경계를 검토해야 합니다.

## 동시성 및 ME-06 통합 위험

새 명시적 잠금·스키마는 추가하지 않습니다. PostgreSQL UPDATE의 일반적인 행 잠금과 조건 재평가를 사용합니다.
같은 메뉴에 서로 다른 상태 요청이 겹치면 뒤 쓰기는 행 잠금을 기다리고 나중에 적용된 상태가 남습니다.
이미 같은 상태인 무변경 요청은 별도 행 잠금 획득을 보장하지 않습니다. 성공은 요청 평가 시점의 멱등적 결과입니다.
클라이언트 버전·If-Match·충돌 알림·자동 재시도 계약은 추가하지 않습니다.

ME-07 자체는 상태 컬럼만 쓰므로 미리 읽은 메뉴 정보 스냅샷을 덮어쓰지 않습니다.
하지만 다른 경로가 과거 status를 포함한 전체 행 UPDATE를 하면 ME-07 상태를 되돌릴 위험은 남습니다.
ME-06이 **부모 행을 잠근 뒤 최신 행을 읽고 수정**하는 규칙을 유지하면,
먼저 실행된 경로의 잠금 해제 뒤 후속 경로가 진행해 정보와 상태를 함께 보존할 수 있습니다.
잠금 전에 stale Entity를 읽었거나 외부 writer가 이 규칙을 따르지 않으면 보호를 보장하지 않습니다.

실제 DB 테스트에서 정보 쓰기 트랜잭션의 SELECT FOR UPDATE→최신 status 읽기→정보 UPDATE를 구성해
ME-07 전/후 두 순서 모두 DB Lock 대기 및 정보·상태 보존을 확인했습니다.
이는 **동등한 DB 쓰기 패턴 검증**이며 미병합 #123의 실제 Service·HTTP 코드 통합 검증이 아닙니다.
#123 코드를 가져오거나 변경하지 않았고 실제 ME-06·07 통합 회귀는 후속 작업입니다.

## 인증 및 선행 PR 통합

#112 미확정이므로 MenuStatusAuthorization은 실제 요청을 항상 403으로 거부합니다.
Controller에서 ID 변환·본문 읽기·DB 작업보다 먼저 실행하며 역할/사용자 헤더·임의 JWT·Servlet 신원·프로필·환경 변수로 허용하지 않습니다.
MVC 경로 선택 단계의 미디어 타입/Accept 415/406 등은 프레임워크 처리와 구분합니다.
성공 HTTP 테스트에서만 권한 경계를 모의했습니다. 실제 STORE_ADMIN 200·비회원 401·CUSTOMER 403은 미구현·미검증입니다.

작업 시작 시 main과 원격 #124 시작점은 `c5135918f9d55ae4ea33739d9aa49f2803f5c6bc`였습니다.
#105·#117·#119·#123은 모두 미병합이며 코드 복사·merge·타 브랜치 수정을 수행하지 않았습니다.

- Controller는 `/status` PATCH만 소유하므로 조회·등록·정보 수정 경로와 공존할 수 있습니다. 공통 관리자 Controller로 옮길 경우 매핑 중복을 피합니다.
- 기본 차단 bean은 독립 구현입니다. 선행 PR 통합 시 공통 관리자 권한 경계 하나로 결합하고 임시 boundary bean과 공통 인증 예외 중복을 정리합니다.
- ExceptionHandler는 상태 Controller 범위에 한정됩니다. 공통 Advice 통합 시 우선순위·업무별 오류 정책을 보존해야 합니다.
- DB 제외 HTTP 테스트는 새 MenuStatusRepository mock이 필요합니다. 기존 MenuServiceApplicationTests에는 그 mock 하나만 추가했습니다. 선행 PR의 mock·컨텍스트 의존성 중복/누락을 통합해야 합니다.
- ME-06과 함께 쓰는 영속성 컨텍스트·행 잠금·상태 덮어쓰기 규칙을 점검하고 ME-01~07·MI-01·MI-02·PostgreSQL 전체 회귀가 필요합니다.
- 기존 MI-01은 ON_SALE 및 활성 옵션만 구매 허용하고 MI-02는 세 상태 모두 존재로 반환합니다. 실제 DB 상태 변경 후 이 규칙을 검증했습니다.
- #105의 실제 고객 ON_SALE/PAUSED 노출·HIDDEN 비노출, 관리자 조회/등록/정보 수정 통합은 미검증입니다.
- #112 합의 후 실제 권한 200/401/403, 직접 Service 호출·Gateway 우회·헤더/JWT 위조 방지를 검증해야 합니다.

인증·보안/API 계약 관련 필수 외부 리뷰 및 원격 CI 성공은 향후 제출 조건입니다.
이번 범위는 로컬 구현·검증·문서·커밋이며 Push·PR 생성·리뷰 요청·Ready 전환·승인·병합을 수행하지 않습니다.
인증과 통합의 미완료를 명시한 Draft PR 제출 자료로 사용할 수 있지만 Issue 전체 완료로 간주하지 않습니다.

## 실제 검증 (2026-11-19, Asia/Seoul)

Java 21.0.7 / 기존 Gradle 8.14.3·Spotless·formatter를 사용했습니다.
PostgreSQL 16.16 바이너리로 TEMP 아래 새 전용 data 디렉터리를 initdb로 생성했습니다.
전용 `127.0.0.1:54435`, DB `menu_124_isolated`, 역할 `menu124_owner`와 임시 비밀번호 환경 주입을 사용했습니다.
초기화용 비밀번호 파일을 제거했으며 공유 개발 DB 및 기존 PostgreSQL 18 서비스는 변경하지 않았습니다.

```powershell
# services/menu-service, 격리 DB 전용 MENU_DB_TEST_* 설정 상태
.\gradlew.bat spotlessApply
.\gradlew.bat spotlessCheck test build --rerun-tasks --console=plain
git diff --check
```

| 클래스                              | 통과    | 실패·오류·생략 |
| ----------------------------------- | ------- | -------------- |
| MenuStatusRequestTests              | 18      | 0              |
| MenuStatusServiceTests              | 12      | 0              |
| MenuStatusHttpTests                 | 24      | 0              |
| MenuStatusAuthorizationTests        | 5       | 0              |
| MenuStatusDatabaseTests             | 18      | 0              |
| 기존 MenuDatabaseTests              | 35      | 0              |
| 기존 MenuServiceApplicationTests    | 46      | 0              |
| 기존 MenuExistenceServiceTests      | 9       | 0              |
| 기존 PurchaseValidationServiceTests | 23      | 0              |
| **전체**                            | **190** | **0**          |

XML 합산 결과이며 **실제 PostgreSQL 검사는 53건**입니다. 신규 18건에는 9개 전이 조합과 반복 호출,
상태별 실제 MI-01·MI-02, 미존재 메뉴, 상태 이외 필드·옵션 보존, 시각 비감소, 동시 상태 쓰기 및 두 순서의 정보/상태 동시 쓰기가 포함됩니다.
롤백 테스트는 테스트 전용 Repository spy에서 실제 SQL 쓰기 직후 DB 예외를 주입하고 서비스 트랜잭션 밖에서 상태·시각 복원을 확인합니다.
정상 쓰기는 실제 Repository의 native query를 실행합니다. 동시성 검사는 실제 두 트랜잭션과 pg_stat_activity의 Lock 대기를 확인합니다.
Gradle 10개 task 실제 실행, BUILD SUCCESSFUL 및 실제 기본 차단·HTTP/OpenAPI·기존 MI 회귀를 확인했습니다.
Flyway V1 성공과 종료 전 categories/menus/menu_options 각 0행을 확인하고 전용 서버를 정상 종료했습니다.

#108 `237b2eb`, #110 `7ce078d`, #118 `c94ae37`, #120 `895c1ed` 및 WIP `242765d`를 보존했습니다.
작업 시작 기준 bin 117개·백업 4개, 총 121개 파일의 해시 변화는 0건입니다.
기존 Order bin 변경·추가를 임의 정리·복구하지 않았으며 bin·백업은 스테이징하지 않습니다.
로그·DB 확인·해시 기준·XML 사본은 TEMP의 `peak124-ce1ab01849fd439da4071cdb70683bc1`에 남겼습니다.
원격 CI·실제 인증·선행 PR 통합은 로컬 통과 결과에 포함하지 않습니다.

### 최신 main 통합 후 Draft PR 제출 전 재검증 (2026-11-19)

fetch 후 `origin/main`은 `df38c7fd429f3a5801ca30844d4f9996720b9514`였습니다.
새 변경은 Order 취소 API 관련 24개 파일로 Menu 구현과 겹치지 않았습니다.
merge-tree 검사 및 `git merge --no-edit origin/main` 모두 충돌 없이 성공했습니다.
통합 커밋은 `b63d3ff54e4f2f93bd8a7f8fb2079dab037c36e9`이며 ME-07 소스·테스트·제안 계약은 `07d6559` 대비 동일합니다.
#105·#117·#119·#123은 조회 시 미병합이며 해당 코드를 가져오지 않았습니다.

새 전용 PostgreSQL 16.16 클러스터(`127.0.0.1:53854`, `menu_124_isolated`)에서 Java 21.0.7로
`spotlessCheck test build --rerun-tasks --console=plain`을 다시 실행했습니다.
XML 합산 결과 **190건 통과, 실패·오류·생략 0건**으로 위 클래스별 건수와 같습니다.
실제 PostgreSQL 53건, 9개 전이·HIDDEN 복귀·무변경 재요청 시각 유지·필드 보존·롤백·동시 상태 변경·실제 기본 403·HTTP/OpenAPI·MI-01/02 회귀를 포함합니다.
정보 수정과의 동시성은 DB 쓰기 패턴 검증이며 **실제 ME-06 코드 통합은 여전히 미완료**입니다.
Gradle 10개 task 실제 실행 후 BUILD SUCCESSFUL, Flyway V1 성공 및 종료 전 세 업무 테이블 각 0행을 확인했습니다.
전용 서버 정상 종료와 포트 리스너 소멸을 확인했으며 공유 개발 DB는 사용하지 않았습니다.

제출 단계 시작 시 bin 117개·백업 4개를 해시 기록했습니다. 통합 후 Order bin의 기존 class 22개 변경과 신규 16개(15 class·V4 SQL 1개)를 확인했습니다.
삭제는 0개이며 전체 bin 파일 수는 133개입니다. Inventory/Payment 기존 bin과 백업 4개의 해시는 동일합니다.
Order 산출물의 갱신 시각은 10:31:14로 main 통합 직후이며 변경/추가 경로가 새 Order 소스·V4 마이그레이션과 대응합니다.
VS Code Java 언어 서버가 실행 중이므로 IDE 자동 빌드로 추정하지만, 쓰기 프로세스의 직접 추적 증거는 없어 원인을 확정하지 않습니다.
Order 빌드나 bin 편집·복구·삭제 명령은 실행하지 않았고 bin·백업은 스테이징하지 않았습니다. 이번 시작 시점의 bin과 동일하다고 보고하지 않습니다.
#108/#110/#118/#120 및 WIP `242765d`는 보존했습니다. main 대상 diff는 #124 관련 16개 파일로 생성 산출물·Order 변경을 포함하지 않습니다.
로그·XML 사본·초기 해시·변경 파일 해시/시각은 TEMP의 `peak124-submit-e2badab05d2f44e197fc5dfcee7446fc`에 남겼습니다.
공백·변경 범위 검사 후 이 검증 기록만 추가 커밋하며 제안 계약을 확정으로 바꾸지 않습니다.
미완료 인증·선행 PR 통합을 명시한 Draft PR만 제출하고 새 리뷰 요청·Ready 전환·승인·병합은 하지 않습니다.

### PR #127 최신 main 통합 검증 (2026-11-19)

기존 HEAD `aff347e5827d4b87f2b68f4fc4237f9103187a74`에
`origin/main` `b4724aac6a57df3bb5c891eb0d8e97b73028c0d3`를
`git merge --no-commit --no-ff origin/main`으로 반영했습니다. 텍스트 충돌은 없었습니다.
main의 고객 조회·다른 서비스 변경을 보존하고 #117·#119·#123 미병합 코드는 포함하지 않았습니다.

고객 CustomerMenuHttpTests에는 상태 Service가 필요로 하는 MenuStatusRepository Mock
import·선언을 각 한 줄 추가했습니다. MenuStatusHttpTests와 MenuStatusAuthorizationTests에는
고객 Service가 필요로 하는 CategoryRepository Mock 하나씩만 추가했습니다.
공통 MenuServiceApplicationTests의 main CategoryRepository Mock과 기존 상태 Repository Mock은
각각 한 번만 선언돼 있습니다. 업무 테스트·제품 Repository·Service·Controller·DTO·인증 경계는
기존 구현 그대로이며 새 잠금 방식·스키마·라이브러리는 추가하지 않았습니다.
main 대비 고유 범위는 기존 16개 + 고객 HTTP 테스트 보완 1개의 **17개 파일**입니다.

Java 21.0.7 / 기존 Gradle·Spotless와 기존 PostgreSQL 16.16 바이너리를 사용했습니다.
TEMP 아래 새 데이터 디렉터리·역할 `menu127_owner`·DB `menu_127_main_integration`과
`127.0.0.1:52307`만 사용했습니다. 공유 DB·기존 데이터 디렉터리·역할·DB는 변경하지 않았습니다.

```powershell
# menu-service에서 전용 격리 DB를 가리키는 MENU_DB_TEST_* 지정
.\gradlew.bat --no-daemon spotlessCheck test build --rerun-tasks --console=plain
git diff --check
```

최종 XML 합산 결과입니다.

| 검사                                                       | 실제 실행·통과 | 실패·오류·생략 |
| ---------------------------------------------------------- | -------------- | -------------- |
| MenuStatusRequestTests                                     | 18             | 0              |
| MenuStatusServiceTests                                     | 12             | 0              |
| MenuStatusHttpTests                                        | 24             | 0              |
| MenuStatusAuthorizationTests                               | 5              | 0              |
| MenuStatusDatabaseTests                                    | 18             | 0              |
| MenuDatabaseTests                                          | 36             | 0              |
| MenuServiceApplicationTests                                | 46             | 0              |
| CustomerMenuHttpTests / CustomerMenuServiceTests           | 35 / 21        | 0              |
| MenuExistenceServiceTests / PurchaseValidationServiceTests | 9 / 23         | 0              |
| 전체                                                       | **247**        | **0**          |

**실제 PostgreSQL 검사는 54건**입니다. 9개 전이와 반복 호출·HIDDEN 복귀, 상태 이외
메뉴/옵션 데이터·ID·생성 시각 보존, 동일 상태의 수정 시각 유지, 상태 변경 시각 비감소,
실제 SQL 쓰기 후 실패 시 전체 롤백을 검증했습니다. 실제 동시 상태 변경에서는
PostgreSQL Lock 대기를 관찰하고 해제 후 마지막 쓰기 결과를 확인했습니다.
조건부 UPDATE와 정보 쓰기 패턴을 두 순서로 함께 실행한 검사는 기존 정책을 확인한 것이며,
**#123의 실제 ME-06 코드와의 통합 동시성 검증은 아닙니다**. 선행 PR 병합 후 별도 검증해야 합니다.

Flyway V1 성공 및 전체 실행 후 categories·menus·menu_options 각각 0행을 확인한 뒤
전용 서버를 종료했습니다. 임시 비밀번호 파일·환경 변수는 제거했습니다.
Spotless·Java 컴파일·test·build·diff 검사 통과이며 기존 제안 계약을 임의 확정하지 않았습니다.

실제 기본 403과 위조 역할·사용자 ID 헤더·검증되지 않은 Bearer 토큰 거부를 확인했습니다.
#112 Auth 계약 정리와 별개로 Gateway 신뢰 경계가 미확정이므로 실제 STORE_ADMIN
인증 연결·비회원 401·CUSTOMER 403은 미완료입니다. 임시 인증 우회는 추가하지 않았습니다.

로그·DB 확인·XML 사본은 TEMP의
`peak127-main-validation-47529cafa99d463084fd34f60d564572`에 보존했습니다.
이번 단계는 로컬 통합·검증까지이며 Commit·Push·PR 상태 변경은 수행하지 않습니다.
