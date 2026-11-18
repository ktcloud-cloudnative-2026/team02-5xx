# Menu 고객 조회 API — ME-01·ME-02 (Issue #95)

> 로컬 API 구현 계약. Notion 원본의 확정/미확정 표는 수정하지 않았습니다. React Mock 데이터 교체는 후속 Issue입니다.

## 공개 목록 — ME-01

`GET /api/v1/menus` (비회원 가능)

| Query | 필수 | 동작 |
| --- | --- | --- |
| `categoryId` | 아니오 | 양의 Long, 생략 시 전체. 존재하지 않는 ID는 빈 `menus` |
| `query` | 아니오 | 이름 부분 검색, 양끝 공백 제거, 대소문자 무시. 비어 있으면 필터 없음 |
| `sort` | 아니오 | `default`(생략 기본값), `priceAsc`, `priceDesc` |

- `data.categories`: `id`, `name` 목록. 메뉴가 없는 카테고리 포함. `sort_order ASC, id ASC`
- `data.menus`: `id, categoryId, name, imageUrl, basePrice, status`
- `HIDDEN`은 결과에서 제외. `ON_SALE`, `PAUSED`는 표시
- `default` 정렬: 카테고리 sort_order, categoryId, menuId 오름차순
- 가격 오름/내림차순 동률: menuId 오름차순
- 첫 구현은 페이지네이션 없이 전체 반환

성공 응답 (`200`):

```json
{
  "success": true,
  "data": {
    "categories": [{"id": 1, "name": "버거"}],
    "menus": [
      {"id": 10, "categoryId": 1, "name": "클래식 버거", "imageUrl": null, "basePrice": 6500, "status": "ON_SALE"}
    ]
  },
  "message": "OK"
}
```

## 공개 상세 — ME-02

`GET /api/v1/menus/{menuId}` (비회원 가능)

- `menuId`: 양의 Long
- `data`: `id, categoryId, name, description, imageUrl, basePrice, status, options`
- `options[]`: `id, name, extraPrice, isDefault, active`, 옵션 ID 오름차순
- 비활성 옵션도 포함하지만 UI에서는 선택할 수 없습니다. `isDefault`는 표시 정보이며 자동 선택하지 않습니다.
- `ON_SALE`·`PAUSED`는 조회 가능, `HIDDEN`·미존재는 동일한 404

성공 응답 (`200`):

```json
{
  "success": true,
  "data": {
    "id": 10,
    "categoryId": 1,
    "name": "클래식 버거",
    "description": "메뉴 설명",
    "imageUrl": null,
    "basePrice": 6500,
    "status": "PAUSED",
    "options": [{"id": 31, "name": "세트", "extraPrice": 2500, "isDefault": true, "active": false}]
  },
  "message": "OK"
}
```

## 오류 계약

| 상황 | HTTP | errorCode |
| --- | --- | --- |
| 잘못된 메뉴/카테고리 ID 또는 sort | 400 | `INVALID_REQUEST` |
| 상세 미존재 또는 HIDDEN | 404 | `MENU_NOT_FOUND` |
| DB 실패·예상하지 못한 오류 | 500 | `INTERNAL_ERROR` |

오류도 `success=false, data=null(생략 가능), message, errorCode` 공통 형식입니다. SQL·연결 문자열·스택 추적은 반환하지 않습니다.

## 책임 범위 및 제한

- 재고·품절/최대 주문량 판단은 Inventory, 결제·주문 확정 전 최신 검증은 MI-01/Order 책임
- 프론트 PR #80의 `ingredients`·`nutrition`은 DB 컬럼이 없어서 응답하지 않음
- 프론트 옵션 라디오 단일 선택과 MI-01 `optionIds[]` 복수 가능 계약은 후속 화면 연동 시 결정
- 실제 PostgreSQL·Gateway·React 통합 검증은 이번 구현 검증과 구별
- 기존 Menu Entity/Flyway, MI-01, MI-02 및 다른 서비스 소스는 변경하지 않음
