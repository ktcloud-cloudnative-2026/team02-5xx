# MI-02 메뉴 존재 확인

- `GET /internal/v1/menus/{menuId}/existence`
- 호출자: Inventory (`IN-05` 관리자 재고-메뉴 연결)
- 근거: [Issue #91](https://github.com/ktcloud-cloudnative-2026/team02-5xx/issues/91), Inventory 담당자와 합의한 계약
- 입력: 1 이상 9223372036854775807 이하의 Long 경로 ID

## 정상 응답: HTTP 200

```json
{"success":true,"data":{"menuId":1,"exists":true,"status":"ON_SALE"},"message":"OK"}
```

| DB 조회 결과 | exists | status |
| --- | --- | --- |
| ON_SALE | true | ON_SALE |
| PAUSED | true | PAUSED |
| HIDDEN | true | HIDDEN |
| 레코드 없음 | false | null |

```json
{"success":true,"data":{"menuId":999,"exists":false,"status":null},"message":"OK"}
```

미존재 시에도 요청한 menuId를 반환합니다. `status` 필드는 생략하지 않고 JSON null로 반환합니다.
**미존재의 `exists=false, status=null` 표현은 제안된 세부 사항으로 구현했으며 최종 확인 대상입니다.**
응답의 menuId는 JSON 정수이고 status는 저장된 상태 문자열입니다.

Menu는 판매 상태로 존재 여부를 필터링하지 않습니다. HIDDEN은 논리 삭제이므로 존재합니다.
Inventory가 ON_SALE·PAUSED 신규 연결 허용, HIDDEN 신규 연결 차단 및 기존 연결 유지 정책을 판단합니다.
Menu는 연결 가능 여부, 재고 수량, 품절, 주문 구매 가능 여부를 판단하지 않습니다.
조회 결과는 조회 시점의 정보이며 연결 시점까지 상태를 고정하지 않습니다.

## 오류

| 조건 | HTTP | errorCode |
| --- | --- | --- |
| 0, 음수, 문자열, 소수, Long 범위 초과 menuId | 400 | INVALID_REQUEST |
| DB 접근 실패·그 밖의 서비스 내부 오류 | 500 | INTERNAL_ERROR |

```json
{"success":false,"message":"menuId must be a positive Long integer","errorCode":"INVALID_REQUEST"}
```

```json
{"success":false,"message":"Internal server error","errorCode":"INTERNAL_ERROR"}
```

기존 서비스의 공통 응답 방식과 일반 오류 코드 이름을 사용합니다.
오류에서는 null인 data를 생략하며 정상 응답에는 errorCode를 넣지 않습니다.
DB/서비스 장애를 메뉴 미존재로 변환하지 않습니다. 오류 원문이나 DB 접속 정보는 응답에 노출하지 않습니다.

## 구현·검증 범위

기존 Menu Entity 및 MenuRepository.findById를 읽기 전용 트랜잭션으로 재사용합니다.
Menu DB·Flyway·다른 서비스·Notion은 변경하지 않습니다.
main에 병합된 PR #90의 MI-01 구현과 공통 ApiResponse를 재사용하며, MI-02 전용 Controller·예외 처리기를 사용합니다.

Service 단위 테스트와 임의 포트 실제 HTTP 테스트는 Repository를 모의 실행합니다.
상태 3종, 미존재 및 명시적 null 직렬화, Long 최대값, 잘못된 ID,
DB/내부 오류의 500 변환 및 정보 비노출, OpenAPI와 Swagger UI를 검증합니다.
DB 자동 설정을 제외한 문서/HTTP 테스트이므로 PostgreSQL 및 Inventory 프로세스 간 연동 검증을 대신하지 않습니다.
공유 menu_dev에서 데이터 변경·Flyway 재적용을 하지 않습니다.

```powershell
# services/menu-service에서 Java 21 사용. MENU_DB_TEST_*는 별도 폐기 가능한 DB에만 설정합니다.
.\gradlew.bat spotlessCheck test build
git diff --check
```

서비스 간 API 계약이므로 추후 PR은 작성자 외 팀원 1명 승인 및 CI 통과가 필요합니다.
