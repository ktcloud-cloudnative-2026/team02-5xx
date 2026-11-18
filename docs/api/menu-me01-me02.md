# ME-01·ME-02 고객 메뉴 조회

기준: [Issue #95](https://github.com/ktcloud-cloudnative-2026/team02-5xx/issues/95),
[공통 개발 규칙](../../CLAUDE.md), [현행 API 초안](notion-draft.md), [Menu ERD](../erd/notion-draft.md).
비회원도 조회할 수 있는 읽기 전용 API입니다. 응답은 기존 `ApiResponse`의 JSON 형식입니다.

## ME-01: GET /api/v1/menus

| 쿼리 | 규칙 |
| --- | --- |
| categoryId | 선택. 양의 Long. 전체 카테고리는 파라미터 생략 (`all` 전송 금지). 없는 카테고리는 200 + 빈 menus |
| query | 선택. 앞뒤 공백 제거 후 Locale.ROOT 기준 대소문자 구분 없는 이름 부분 검색. 빈 값·공백만 있으면 필터 없음 |
| sort | 선택. 생략 시 default. default / priceAsc / priceDesc만 허용 |

같은 쿼리 키를 여러 번 보내면 400입니다. 명시적으로 빈 categoryId·sort도 400입니다.
검색어의 내부 공백은 유지하며 `%`, `_`는 와일드카드가 아닌 일반 문자로 검색합니다.

기본 순서: `categories.sort_order ASC, categories.id ASC, menus.id ASC`.
가격순은 basePrice 오름차순/내림차순이며, 동률은 항상 메뉴 ID 오름차순입니다.
페이지네이션 없이 ON_SALE·PAUSED 메뉴 전체에서 카테고리·검색 필터와 정렬을 적용합니다.
HIDDEN은 Repository 조회 단계에서 제외합니다. 카테고리는 필터·검색과 관계없이 전체를
`sortOrder ASC, id ASC`로 반환하며, 메뉴가 없는 카테고리도 포함합니다.

```json
{
  "success": true,
  "data": {
    "categories": [{"id": 1, "name": "버거"}],
    "menus": [{"id": 10, "categoryId": 1, "name": "클래식 버거", "imageUrl": null, "basePrice": 6500, "status": "ON_SALE"}]
  },
  "message": "OK"
}
```

## ME-02: GET /api/v1/menus/{menuId}

menuId는 양의 Long입니다. ON_SALE·PAUSED는 200이며, HIDDEN과 미존재는 같은 404 응답입니다.
옵션은 ID 오름차순으로 반환하고 비활성 옵션과 기본 옵션 여부도 그대로 제공합니다.
옵션이 없으면 빈 배열입니다. description·imageUrl이 없으면 JSON null을 명시합니다.

```json
{
  "success": true,
  "data": {
    "id": 10, "categoryId": 1, "name": "클래식 버거", "description": null,
    "imageUrl": null, "basePrice": 6500, "status": "PAUSED",
    "options": [{"id": 31, "name": "세트", "extraPrice": 2500, "isDefault": true, "active": false}]
  },
  "message": "OK"
}
```

## 오류

| 조건 | HTTP | errorCode | message |
| --- | --- | --- | --- |
| ID가 0·음수·문자열·소수·Long 범위 초과, 잘못된 정렬·쿼리 형식 | 400 | INVALID_REQUEST | Invalid menu query parameters |
| 상세 미존재·HIDDEN | 404 | MENU_NOT_FOUND | Menu not found |
| DB 또는 예상하지 못한 서비스 오류 | 500 | INTERNAL_ERROR | Internal server error |

```json
{"success":false,"message":"Menu not found","errorCode":"MENU_NOT_FOUND"}
```

성공 응답에는 errorCode가 없고, 오류 응답에는 null data를 생략합니다.
DB 오류를 빈 목록이나 404로 변환하지 않으며 SQL·접속 정보·예외 원문을 응답에 노출하지 않습니다.
공개 API에만 적용되는 Controller 범위의 예외 처리기를 사용해 MI-01·MI-02 매핑을 유지합니다.
OpenAPI JSON(`/v3/api-docs`)에는 성공 DTO와 공통 오류 envelope 및 상태 코드를 문서화합니다.

## 책임과 구현 범위

읽기 전용 트랜잭션과 기존 Entity·공통 ApiResponse를 사용합니다. 공개 메뉴 목록은
카테고리를 EntityGraph로 함께 조회해 카테고리별 추가 조회를 방지하고, 필터·정렬은 Service에서 처리합니다.
이번 계약은 전체 목록 반환이므로 데이터 규모가 커질 때의 페이지네이션은 별도 작업입니다.

재고·품절·주문 가능 수량은 Inventory 책임입니다. PAUSED 조회 허용이 주문 허용을 의미하지 않습니다.
주문 시 MI-01과 Inventory에서 재검증하며 가격 확정·주문 생성·옵션 자동 선택은 하지 않습니다.
DB/Flyway·신규 의존성·다른 서비스·React 코드는 변경하지 않습니다.
React의 PAUSED 상세 진입, ingredients/nutrition 표시, 단일/복수 옵션 선택 정책은 후속 연동 시 확인합니다.
기존 Notion 원문의 수정 전/후 표는 보존하고 이 로컬 상세 명세로 계약을 보완합니다.

## 검증 결과

Java 21, Spring Boot 4.1.2, 기존 Google Java Format 1.28.0을 사용했습니다.

```powershell
# services/menu-service에서 실행. 공유 menu_dev를 테스트 DB로 지정하지 않습니다.
.\gradlew.bat spotlessApply spotlessCheck test build
git diff --check
```

- CustomerMenuServiceTests 21건, CustomerMenuHttpTests 35건: 카테고리/기본·가격 정렬과 동률,
  이름 검색·빈 목록, 입력 경계값, 상태 정책, 옵션·null 직렬화, 오류 비노출, OpenAPI 검증.
- 기존 MI-01·MI-02 HTTP/OpenAPI 46건 및 Service 32건을 보존해 전체 134건 통과.
- 실제 PostgreSQL 검증은 미실행. MenuDatabaseTests 10건은 MENU_DB_TEST_URL 미설정으로 건너뜀.
  신규 DB 테스트는 HIDDEN 제외·카테고리 동시 로딩·활성/비활성 옵션의 ID 정렬을 검사합니다.
- 실제 Gateway·React·Inventory 프로세스 연동은 미검증입니다.
- HTTP 테스트는 실제 임의 포트 서버·Controller·Service·Jackson을 거치지만 Repository는 모의 실행합니다.

계약/공개 범위에 영향을 주는 변경이므로 작성자 외 팀원 리뷰 승인 및 CI 성공 후 병합해야 합니다.
