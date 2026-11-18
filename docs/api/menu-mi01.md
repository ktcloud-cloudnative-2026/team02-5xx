# MI-01 메뉴 구매 검증

- `POST /internal/v1/menus/validate-purchase`
- 호출자: Order, Cooking (PR #86 A안)
- 근거: [Issue #89](https://github.com/ktcloud-cloudnative-2026/team02-5xx/issues/89),
  [Order PR #46](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/46),
  [Cooking 합의](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/86#pullrequestreview-5934301569)

## 요청

```json
{"items":[{"menuId":1,"quantity":2,"optionIds":[3,4]}]}
```

`items`는 비어 있지 않은 배열이며 각 항목은 null일 수 없습니다.
`menuId`는 양수 Long, `quantity`는 양수 Integer입니다.
`optionIds`는 필수 배열이며 옵션이 없으면 `[]`를 전달합니다.
각 옵션 ID는 양수 Long이고 같은 항목 안에서 중복할 수 없습니다.
같은 메뉴를 별도 항목으로 요청하는 것은 허용합니다.
수량 상한은 JSON Integer 범위이며 별도의 업무 상한은 추가하지 않았습니다.

## 성공: HTTP 200

```json
{
  "success": true,
  "data": {
    "items": [{
      "menuId": 1,
      "menuName": "버거",
      "unitPrice": 6500,
      "cookTimeSec": 90,
      "options": [
        {"optionId": 3, "optionName": "세트", "extraPrice": 2500, "extraCookTimeSec": 30},
        {"optionId": 4, "optionName": "추가", "extraPrice": 0, "extraCookTimeSec": 0}
      ]
    }]
  },
  "message": "OK"
}
```

응답 `data.items[]`는 요청 순서 및 항목 수를 유지하고 `options[]`도 선택 순서를 유지합니다.
`unitPrice`는 **기본 메뉴 1개 가격**이며 옵션이나 수량을 합산하지 않습니다.
가격과 시간은 DB의 필수 비음수 Integer 값을 반환합니다. 0은 허용합니다.
`cookTimeSec`는 메뉴 1개 기본 초, `extraCookTimeSec`는 선택 옵션 1개 추가 초입니다.
Order는 `(unitPrice + 선택 옵션 extraPrice 합) × quantity`로 가격을 계산하고,
Cooking은 `(cookTimeSec + 선택 옵션 extraCookTimeSec 합) × quantity`로 시간을 계산합니다.
기본 옵션을 자동 선택하지 않으며 선택하지 않은 옵션은 반환하지 않습니다.

메뉴는 존재하고 `ON_SALE`이어야 합니다. `PAUSED`, `HIDDEN`, 없는 메뉴는 모두 실패합니다.
옵션은 존재하고 active이며 해당 메뉴 소속이어야 합니다.
하나라도 실패하면 전체 요청을 실패시키고 부분 성공은 반환하지 않습니다.
읽기 전용 트랜잭션으로 조회하며 재고 검사·확보·가격 고정·주문 생성은 수행하지 않습니다.
재고 판단은 Inventory 소유이고 실제 주문/결제 시에는 다시 검증해야 합니다.

## 오류와 미확정 계약

```json
{"success":false,"message":"Menu is not available for purchase","errorCode":"INVALID_REQUEST"}
```

- 잘못된 JSON/필드, 구매 불가 메뉴·옵션: HTTP 400 + `INVALID_REQUEST`
- 저장 데이터의 잘못된 이름·음수 가격/시간, DB/내부 장애: HTTP 500 + `INTERNAL_ERROR`
- 오류 응답에는 DB 접속 정보나 예외 원문을 노출하지 않습니다.

위 코드는 저장소의 기존 일반 오류 이름을 재사용한 **현재 Menu 구현의 기본 매핑**입니다.
메뉴 미존재/판매중지/옵션별 세부 오류 코드 및 400/404/409 구분은 아직 합의되지 않았습니다.
새 전용 공통 오류 코드를 확정하지 않았으며 연동 전 담당자 합의가 필요합니다.
현재 Order `HttpMenuClient`는 모든 4xx를 `MENU_NOT_AVAILABLE`, 5xx를
`MENU_SERVICE_UNAVAILABLE`로 처리하고 upstream `errorCode` 문자열을 분기하지 않습니다.
따라서 현재 매핑은 해당 소비 동작과 호환됩니다. Cooking의 CO-02 오류 변환은 후속 확인 대상입니다.

## 검증 범위

Service 단위 테스트는 Repository를 모의 실행하여 판매 상태, 옵션 소속·활성 상태,
입력 필드, 순서, 가격·시간 경계값을 검증합니다.
임의 포트 HTTP 통합 테스트는 DB 자동 설정을 제외하고 Repository만 대체하며,
실제 Controller/Service/예외 처리/Jackson/OpenAPI를 통과합니다.
Order 계약과 같은 필드·숫자 타입의 테스트 모델로 응답 역직렬화를 확인합니다.
이는 Order/Cooking 프로세스 간 실제 네트워크 연동이나 PostgreSQL 통합 검증은 아닙니다.
공유 menu_dev에 접근하거나 V1을 재적용하지 않습니다.
