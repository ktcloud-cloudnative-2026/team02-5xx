# CO-02 주문 전 예상 시간

- `POST /api/v1/cooking/estimates`
- 권한: 전체 (주문 전 장바구니 화면)
- 근거: [Issue #103](https://github.com/ktcloud-cloudnative-2026/team02-5xx/issues/103),
  [MI-01 계약 합의(A안)](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/86#pullrequestreview-5934301569),
  [PR #106](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/106)

고객이 고른 메뉴·옵션·수량으로 "조리 시작까지 예상 대기"와 "선택 메뉴 조리 시간"을 계산합니다.
조리 시간은 클라이언트 값을 받지 않고 Menu [MI-01](menu-mi01.md)에서 받은 값으로 계산합니다(값 조작 방지).
주문을 만들거나 대기열 자리를 잡지 않으며, 실제 주문 시점의 대기 시간과는 다를 수 있습니다.

## 요청

```json
{"items":[{"menuId":1,"quantity":2,"optionIds":[10]},{"menuId":2,"quantity":1}]}
```

MI-01 요청과 같은 모양입니다.

- `items`: 1~50개, 각 항목은 null일 수 없습니다.
- `menuId`: 양수 Long, `quantity`: 양수 Integer
- `optionIds`: 생략 가능(생략하면 `[]`로 MI-01에 전달), 각 ID는 양수 Long, 같은 항목 안에서 중복할 수 없습니다.

## 성공: HTTP 200

```json
{
  "success": true,
  "data": {"expectedWaitSec": 420, "cookSec": 390, "expectedReadySec": 810},
  "message": "OK"
}
```

| 필드 | 의미 | 계산 |
|---|---|---|
| `expectedWaitSec` | 지금 주문하면 조리 시작까지 예상 대기(초) | CO-01 `expectedWaitSec`와 같은 값 = 조리 중 전표 남은 시간 + 대기(WAITING) 전표 예상 조리 시간 합 |
| `cookSec` | 선택한 메뉴들의 조리 시간 합(초) | Σ((MI-01 `cookTimeSec` + 선택 옵션 `extraCookTimeSec` 합) × `quantity`) |
| `expectedReadySec` | 조리 완료까지 예상(초) | `expectedWaitSec` + `cookSec` |

예: 아메리카노(120초) + 샷 추가(+30초) × 2, 라떼(90초) × 1 → `cookSec` = (120+30)×2 + 90 = 390

조리는 한 번에 한 주문씩 순서대로 진행하는 기준입니다(회의록 11/11 순차 자동 조리).

## 실패

```json
{"success":false,"message":"주문할 수 없는 메뉴 또는 옵션이 포함되어 있습니다.","errorCode":"MENU_NOT_AVAILABLE"}
```

| 상황 | HTTP | errorCode |
|---|---|---|
| 요청 형식 오류 (빈 목록, 51개 이상, 항목 null, 수량 0 이하, 옵션 ID 중복·null, 깨진 JSON) | 400 | `INVALID_REQUEST` |
| Menu 4xx (판매 중지·숨김·없는 메뉴, 없는 옵션, 다른 메뉴의 옵션) | 409 | `MENU_NOT_AVAILABLE` |
| Menu 5xx · 연결 실패 · 타임아웃 | 503 | `MENU_SERVICE_UNAVAILABLE` |
| Menu 응답 이상 (항목 수·menuId·옵션 불일치, 시간 필드 누락, 깨진 JSON) | 502 | `UPSTREAM_INVALID_RESPONSE` |

- Menu는 판매 불가를 400 `INVALID_REQUEST`로 응답하지만, Cooking은 이를 **409 `MENU_NOT_AVAILABLE`로 변환**합니다.
  Order도 MI-01 4xx를 같은 코드로 변환하므로 프론트엔드는 두 API에서 같은 코드를 받습니다(PR #106 리뷰 합의).
- 요청 형식 오류는 Cooking이 MI-01 호출 전에 400으로 거절하므로, Menu 4xx는 사실상 판매 불가만 남습니다.
- Menu의 upstream `errorCode`·예외 원문은 응답에 노출하지 않습니다.

## Menu 호출 설정

| 설정 | 환경 변수 | 기본값 |
|---|---|---|
| `menu.base-url` | `MENU_SERVICE_URL` | `http://localhost:8081` |
| `menu.connect-timeout-ms` | - | 1000 |
| `menu.read-timeout-ms` | - | 2000 |

Menu HTTP 호출 동안 Cooking DB 트랜잭션을 잡지 않습니다.
