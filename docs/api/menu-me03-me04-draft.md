# ME-03·ME-04 관리자 조회 — 기본 차단 상태의 HTTP 구현

기준: [Issue #108](https://github.com/ktcloud-cloudnative-2026/team02-5xx/issues/108),
[API 초안 수정 후 Menu 표](notion-draft.md), [Menu ERD 3-3](../erd/notion-draft.md), [CLAUDE.md](../../CLAUDE.md).

## 확정 범위와 현재 상태

관리자는 ON_SALE·PAUSED·HIDDEN 메뉴와 활성/비활성 옵션을 조회할 수 있어야 합니다.
접근 권한은 STORE_ADMIN으로 한정합니다. 재고·품절·주문 가능 수량은 Inventory 책임입니다.

기존 읽기 전용 Service·Repository·DTO를 재사용해 Controller·관리자 범위 예외 처리·OpenAPI를 추가했습니다.
`GET /api/v1/admin/menus`(ME-03), `GET /api/v1/admin/menus/{menuId}`(ME-04)는 등록되어 있지만
**실제 실행에서는 모두 403 / FORBIDDEN으로 차단되며 조회 Service·Repository에 접근하지 않습니다.**
OpenAPI도 이 기본 차단 상태와 성공 응답의 제안 계약을 함께 명시합니다.
실제 STORE_ADMIN 인증·인가 연결은 아직 구현/검증되지 않았으며 #108 전체 완료 상태가 아닙니다.

### 기본 차단과 테스트 경계

AdminMenuAuthorization.requireStoreAdmin()은 인자 없이 항상 접근 거부 예외를 발생시킵니다.
헤더·Bearer 문자열·Servlet principal을 신뢰하거나 읽지 않고, 프로필·환경 변수·기능 플래그로 해제하는 경로도 없습니다.
공개 배포에서 관리자 데이터 조회를 허용하려면 별도 검토된 코드 변경과 실제 인증·인가 연동이 필요합니다.
새 JWT 방식·인증 의존성·Gateway 정책·권한 헤더 계약은 추가하지 않았습니다.

권한 경계는 Controller 진입 시 파라미터 변환/검증보다 먼저 실행합니다.
실제 차단 테스트는 원래 권한 bean을 사용하며 위조 X-Role/X-User-Role/사용자 헤더와
검증되지 않은 Authorization 값에도 403과 데이터 미조회를 확인합니다.
별도 AdminMenuHttpTests만 @MockitoBean으로 권한 판정 결과를 대체하여 관리자 허용·미인증·권한 부족을 모의합니다.
이 대체 bean은 테스트 소스에만 있으며 배포 소스나 설정으로 허용하는 기능은 없습니다.
모의 테스트 성공은 실제 토큰 검증·관리자 신원 확인·Gateway 연동 성공을 의미하지 않습니다.

## 제안 계약 — 리뷰 확인 대상

아래 필드·필터·정렬 정책은 Issue #108의 제안 계약입니다. 최종 승인된 HTTP 계약과 구분합니다.

### 목록 Service

`AdminMenuQueryService.list(categoryId, query, status, sort)`

| 입력 | 제안 동작 |
| --- | --- |
| categoryId | 선택적 양의 Long. null은 전체, 없는 카테고리는 빈 menus |
| query | 선택적 메뉴명 부분 검색. 앞뒤 공백 제거, Locale.ROOT로 대소문자 무시. null·빈 문자열·공백만 있으면 전체 |
| status | null은 세 상태 전체. ON_SALE / PAUSED / HIDDEN만 허용. 빈 문자열·소문자·복수 상태는 잘못된 입력 |
| sort | null이면 default. default / priceAsc / priceDesc만 허용 |

기본 정렬은 categories.sort_order → categories.id → menus.id ASC입니다.
가격순의 동률은 메뉴 ID ASC입니다. 검색어 내부 공백은 유지하고 `%`, `_`도 일반 문자로 취급합니다.
페이지네이션 없이 전체 목록에서 Service가 필터·정렬합니다.

목록 data:

- categories[]: id, name. 필터와 무관하게 전체 카테고리를 sortOrder·id ASC로 제공하며 빈 카테고리도 포함.
- menus[]: id, categoryId, name, imageUrl, basePrice, cookTimeSec, status.
- 빈 결과는 빈 배열. imageUrl이 없으면 명시적 null.

### 상세 Service

`AdminMenuQueryService.detail(menuId)`

- 양의 Long만 허용. HIDDEN도 정상 반환하고 실제 미존재만 MENU_NOT_FOUND.
- data: id, categoryId, name, description, imageUrl, basePrice, cookTimeSec, status, createdAt, updatedAt, options[].
- options[]: id, name, extraPrice, extraCookTimeSec, isDefault, active. Repository가 ID ASC로 조회하며 비활성 옵션도 포함.
- 옵션 자동 선택·쓰기 동작 없음. 옵션이 없으면 빈 배열, description/imageUrl이 없으면 null.
- createdAt/updatedAt은 기존 Entity의 Instant를 그대로 전달하며 임의 시각을 생성하지 않음.

### HTTP 매핑과 미확정 권한 계약

| 상황 | 동작 | HTTP |
| --- | --- | --- |
| 잘못된 ID·상태·정렬 | AdminMenuQueryException(INVALID_REQUEST) | 400 |
| 실제 미존재 상세 | AdminMenuQueryException(MENU_NOT_FOUND) | 404 |
| DB·그 외 내부 장애 | 원래 예외를 전파하며 빈 결과·미존재로 변환하지 않음 | 500 / INTERNAL_ERROR |
| 실제 실행의 기본 차단 | AdminMenuAuthorization에서 항상 거부 | 403 / FORBIDDEN |
| 테스트에서 모의한 미인증 | 모의 권한 경계에서 거부 | 401 / UNAUTHORIZED |
| 테스트에서 모의한 권한 부족 | 모의 권한 경계에서 거부 | 403 / FORBIDDEN |

400/404/500 응답은 허용된 권한 판정 이후에만 도달하며 현재는 모의 권한 경계에서 검증했습니다.
401/403의 구분과 오류 코드는 현재의 로컬 임시 매핑으로, 최종 Auth/Gateway 계약을 확정한 것이 아닙니다.
기본 실행 경로의 미인증 요청도 의도적으로 모두 403으로 거부합니다.
기존 ApiResponse는 수정하지 않았고 모든 응답에 재사용합니다. 오류에서는 data를 생략하고
SQL·접속 정보·예외 원문을 노출하지 않습니다. 기존 MI-01·MI-02·고객 조회 오류 정책은 변경하지 않습니다.
Controller는 문자열/Long 범위 초과·0/음수 ID, 잘못된 상태/정렬, 빈 categoryId와
같은 categoryId/query/status/sort 키의 반복을 INVALID_REQUEST로 처리합니다.

```json
{"success":false,"message":"Administrator access denied","errorCode":"FORBIDDEN"}
```

## PR #105와 분리

최신 main 기준의 별도 feat/108-menu-admin-query 브랜치에서 작업했습니다.
미병합 #105의 고객 Controller·Service·DTO·예외 처리를 복사하거나 수정하지 않았습니다.
기존 MenuRepository/MenuOptionRepository 대신 관리자 전용 AdminMenuQueryRepository를 추가했습니다.
이 Repository는 Menu·MenuOption을 읽는 JPQL만 제공하며 카테고리는 기존 CategoryRepository를 재사용합니다.
카테고리는 메뉴 조회에 join fetch로 포함하고, Entity·Flyway·의존성·다른 서비스는 변경하지 않습니다.

중복 관심사는 카테고리 정렬·검색·가격 정렬과 옵션 조회이며, 고객/관리자의 노출 정책과 반환 필드는 다릅니다.
#105 병합 뒤 공통화 필요성을 검토할 수 있지만 이번 작업에서 고객 코드를 재구현하거나 선행 브랜치를 수정하지 않습니다.
공유 수정 파일은 README와 MenuServiceApplicationTests입니다. README에는 별도 절을 추가하고
기존 HTTP 테스트에는 관리자 Repository/Category mock과 실제 기본 차단·헤더 위조 방지 검사를 추가했습니다.
#105의 Category mock 추가와 겹칠 수 있으므로 향후 통합 시 중복 선언을 제거하고 모든 회귀 검사를 유지해야 합니다.
현재 main에는 ME-01·ME-02가 없으므로 이 브랜치에서 고객 API 회귀 실행 완료를 주장하지 않습니다.
#105의 CustomerMenuHttpTests는 새 AdminMenuQueryService의 의존성인 AdminMenuQueryRepository를
mock하지 않으므로 향후 통합 시 해당 mock을 추가해야 DB 제외 테스트 컨텍스트를 유지할 수 있습니다.
#105 통합은 수행하지 않았으며 고객 조회 회귀 56건 및 추가 DB 조회 검사는 통합 뒤 다시 실행해야 합니다.

## 검증과 후속 작업

Java 21에서 기존 formatter 1.28.0과 `spotlessApply spotlessCheck test build`, `git diff --check`로 검사합니다.
단위 테스트는 세 상태, 카테고리·검색·상태 필터, 기본/가격 정렬과 동률, 빈 결과,
HIDDEN 상세·옵션의 활성/기본값/가격/조리시간, 미존재·잘못된 입력·DB 예외 전파를 검사합니다.
DTO 테스트는 기존 envelope·camelCase·nullable 값·옵션 boolean 필드명을 검사합니다.
기존 MI-01·MI-02 검사와 함께 관리자 경로의 실제 기본 차단·위조 헤더 방지,
모의 권한 경계에서의 관리자 HTTP 정상/400/401/403/404/500, OpenAPI 응답 스키마를 검사합니다.

실제 로컬 결과: `spotlessApply spotlessCheck test build` 성공, 실패·오류 0건.
관리자 Service 34건·DTO 2건·모의 권한 HTTP 45건, 기존 MI-01·MI-02 및 실제 차단 HTTP 검사 54건,
Servlet 신뢰 경계 2건, 기존 Service 32건의 비DB 검사 169건에 더해,
격리 PostgreSQL 16.16에서 기존 DB 35건과 신규 관리자 DB 13건을 실행했습니다.
전체 217건 통과·실패 0건·생략 0건이며 `git diff --check`와 신규 파일 공백 검사도 통과했습니다.
기존의 생략 9건은 메서드 수이고 DB 활성화 시 파라미터 사례가 35건으로 확장됩니다.
Flyway V1 적용과 실제 JPQL·Service 검색/정렬·옵션을 검증했으며 공유 개발 DB에는 접근하지 않았습니다.
격리 구성·데이터 롤백·종료와 실행 근거는 [PostgreSQL 실제 검증 기록](menu-admin-postgresql-validation.md)을 확인합니다.

미확정 사항: JWT 검증 위치, Gateway→서비스의 신뢰 가능한 신원·역할 전달, 401/403 매핑.
임의 헤더나 새로운 보안 의존성으로 이를 대체하지 않습니다. 합의 후에 실제 인증 어댑터 연결과
STORE_ADMIN 정상/401/403 통합 테스트가 필요합니다. 현재 Controller는 기본 차단 상태로 유지하며
#108 전체 완료 및 사용 가능한 관리자 API로 간주하지 않습니다. CI·필수 리뷰·Git 단계도 이번에는 수행하지 않습니다.
ME-05 이후 쓰기 기능, React·Inventory·Gateway 실제 연동은 이번 단계에서 구현하지 않습니다.

Auth 코드·Gateway 선언·미확정 팀 제안을 대조한 근거, 담당자별 결정 요청 및 실제 연동 구현 순서는
[실제 관리자 인증 연동 점검](menu-admin-auth-integration.md)을 확인합니다.
