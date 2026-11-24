# API 명세 초안 — Notion 가져오기

> 기존 Notion 초안의 구조를 유지하며 확인된 최신 합의를 반영합니다. 확정 설계와 구현 상태는 구분하며, 미확정 사항은 구현 기준으로 삼지 않습니다.

- 원본: [API 명세 초안](https://app.notion.com/p/4102f07e9478802f91a4da2ae18ab56f)
- 원본 최종 수정: 2026-11-16T03:27:49.697Z (UTC)
- 가져온 날짜: 2026-11-13 (Asia/Seoul)
- 공통 확정 규칙: [CLAUDE.md](../../CLAUDE.md)
- 최근 계약 확인: 2026-11-17. Notion 최신 API·ERD와 관련 Order·Cooking PR의 합의 및 코드를 대조했습니다. 아래에 별도 표시하지 않은 기존 초안의 승인 상태는 유지합니다.
- Order API 상세 갱신: 2026-11-18. Order PR(#28·#29·#46·#52·#56)의 구현과 Menu PR #90·Payment PR #71의 호출 계약을 확인해 Order Service 절과 Menu·Payment 내부 API 절에 보완 내용을 추가했습니다. Notion 원본의 같은 부분도 맞춰 수정해야 합니다.
- 구현 기준(작성 당시, 2026-11-13): main `4fbbb66`에는 관련 업무 API·Flyway·이벤트 처리가 아직 없었습니다.
- 구현 기준(현재, 2026-11-20): main `b57c266`에는 Order Flyway V1~V6와 주문 생성·조회·결제·취소 API(OR-01~05, PR #28·#29·#46·#61), 관리자 영업·주문 접수 상태 API(OR-06·07, PR #133), 취소 후속 처리의 재시도 상한·수동 확인 표시·지표(PR #135), 주문 상세의 Cooking 조리 상태(OR-04 `cooking`, PR #142), 관리자 주문 목록·검색·상세(OR-08·09, V6 인덱스, PR #170), Order의 RabbitMQ 이벤트 발행·수신(PR #52)과 Cooking 장애 차단(PR #56), Menu MI-01·MI-02(PR #90·#100)와 고객 메뉴 목록·상세 ME-01·ME-02(PR #105), Cooking의 OrderConfirmed 수신(PR #57)·CI-03 취소 API(PR #62)·자동 조리 진행과 CookingCompleted 발행(PR #78)·전표 등록 시각 DB 기록(PR #109)·표시용 문자열 길이 초과 처리(PR #113), Inventory 초기 구성(PR #70)과 내부 API(II-01~04, PR #115), Payment 모의 결제·조회·환불 내부 API(PR #71), Cooking CI-02 예상 시간을 CO-02와 같게 조리 시작까지·완료까지로 나눈 변경(PR #141)이 병합되어 있습니다. 열린 PR의 구현은 main 반영 완료로 표시하지 않습니다.

- 원문의 Menu Service 수정 전·후 표와 논의 사항을 함께 보존했습니다. 이 문서는 원문 보관본이며 두 표를 동시에 유효한 계약으로 간주하지 않습니다.

---

> 초안. 팀 승인 필요

## 공통 규칙

- 공통 응답: success, data, message. 실패 시 errorCode 추가. JSON 필드명은 camelCase.
- 각 MSA는 springdoc-openapi·Swagger UI를 제공하며 RabbitMQ 이벤트는 HTTP API와 별도 관리한다.
- 내부 주소와 경로는 응답에 넣지 않음
- 날짜: ISO 8601 (2026-11-04T09:00\:00+09\:00)
- 업무 ID: 숫자. RabbitMQ eventId는 UUID.
- /api/v1: 프론트엔드가 API Gateway를 통해 호출
- /internal/v1: 서비스 간 호출, 외부 접근 불가

<details>
<summary>화면별 기능 상세</summary>

## 화면 별 기능

1. 헤더 (로그인 / 비로그인) - 전 페이지에 있어야 함.
   1. 로고 클릭 시 홈 화면 이동
   2. 로그인 모달 열기
   3. 장바구니 모달 열기
2. 홈 화면 (로그인 / 비로그인)
   1. 공통
      1. 현재 혼잡도 표시
      2. 대기 주문수
      3. 예상 대기 시간
   2. 비로그인
      1. 메뉴 페이지 이동
      2. 회원가입 페이지 이동
      3. 비밀번호 찾기 페이지 이동으로 메뉴페이지 이동
      4. 로그인 기능
      5. 비밀번호 찾기 페이지 이동
   3. 로그인
      1. 주문 페이지 이동
      2. 주문 상세 보기 클릭시 상세 주문 모달 활성화
      3. 주문 리스트 페이지 이동
3. 로그인 모달
   1. 로그인 기능상태 유지
   2. 아이디 찾기 페이지로 이동
   3. 비밀번호 찾기 페이지로 이동
   4. 회원가입 페이지로 이동
   5. 로그인
   6. 로그인 없이 메뉴 페이지로 이동
4. 메뉴
   1. 메뉴 검색
   2. 메뉴 이미지 클릭 → 상세메뉴 모달 활성화
5. 상세메뉴 모달
   1. 옵션, 수량
   2. 장바구니 버튼 → 장바구니 모달 활성화
   3. 즉시 주문 버튼 → 대기시간 및 조리시간 팝업 활성화
6. 장바구니 모달
   1. 메뉴 정보
   2. 옵션 변경
   3. 수량 조절
   4. 삭제
   5. 주문하기
7. 주문 결제
   1. 주문 생성
   2. Gateway → Order API → 내부 Payment API를 통한 모의 결제 요청
   3. 결제 결과 처리
   4. 결제 실패가 확정되면 기존 임시 주문 종료. 재시도 시 새 임시 Order 생성
8. 결제 완료
   1. 결제 완료 정보 표시
9. 주문 내역 리스트
   1. 내 주문 목록 조회
   2. 각 주문 상세 모달 열기
10. 주문 내역 상세 모달
    1. 상세 주문 내역 표시
    2. 조리 대기 시 주문 취소 버튼 활성화
11. 마이페이지
    1. 닉네임 등 회원 정보 간략히 출력
    2. 회원 정보 변경 페이지 이동
    3. 비밀번호 변경 페이지 이동
12. 회원가입
    1. 이메일(아이디) 중복 확인
    2. 비밀번호 확인(일치)
    3. 이용약관
    4. 개인정보 동의
    5. 전체 동의
13. 아이디/비밀번호 찾기 페이지
    1. 아이디 찾기
    2. 비밀번호 찾기
14. 회원 정보 변경 페이지
    1. 현재 회원정보 리스트
    2. 수정 및 취소 버튼
15. 비밀번호 변경 페이지
    1. 현재 비밀번호 입력
    2. 바꿀 비밀번호 입력
    3. 바꿀 비밀번호 재입력
    4. 변경 취소 버튼
16. 관리자 / 대시보드
    1. 영업상태 변경
    2. 주문 접수 상태 변경
    3. 대기열 주문 건수 확인
    4. 조리완료 건수 확인
    5. 현재 매장 혼잡도
    6. 재고 부족 알림
    7. 현재 주문 대기열 리스트
17. 관리자 / 재고관리
    1. 재고 목록 확인
    2. 재고 등록 모달
    3. 재고 등록
    4. 메뉴 연결
    5. 재고 수량 변경
    6. 재고 검색
    7. 재고 삭제
18. 관리자 / 메뉴관리
    1. 메뉴 목록 확인
    2. 메뉴 등록 모달
    3. 메뉴 등록
    4. 메뉴 삭제
    5. 메뉴 상세 수정
    6. 메뉴 검색
19. 관리자 / 주문 조리 현황
    1. 현재 혼잡도 확인
    2. 주문 대기열 확인
    3. 조리 중 음식 확인
    4. 조리 완료 건수 확인
    5. 대기열에 있는 주문 번호와 접수 시각 확인

</details>

# 외부 API 초안

## Auth Service

| ID | Method | URL 초안 | 기능 | 권한 |
| --- | --- | --- | --- | --- |
| AU-01 | POST | /api/v1/auth/login | 로그인 및 JWT 발급 | 전체 |
| AU-02 | GET | /api/v1/auth/me | 현재 로그인 사용자 조회 | 로그인 |
| AU-03 | POST | /api/v1/auth/register | 회원가입 | 비회원 |
| AU-04 | GET | /api/v1/auth/email-availability | 이메일 중복 확인 | 비회원 |
| AU-05 | PATCH | /api/v1/auth/me | 닉네임 등 회원 정보 수정 | CUSTOMER |
| AU-06 | PATCH | /api/v1/auth/me/password | 현재 비밀번호 확인 및 변경 | CUSTOMER |
| AU-07 | POST | /api/v1/auth/password-reset/requests | 비밀번호 재설정 요청 | 비회원 |
| AU-08 | POST | /api/v1/auth/password-reset/confirm | 비밀번호 재설정 완료 | 비회원 |
| AU-09 | POST | /api/v1/auth/refresh | 토큰 재발급 | 전체 |
| AU-10 | POST | /api/v1/auth/logout | 로그아웃 및 Refresh Token 폐기 | 로그인 |

- 아이디의 형식과 이메일에 대한 논의 필요
- ~~로그아웃 기능에 대한 내용 필요~~⇒AU-10으로 해결

## Menu Service

| ID | Method | URL 초안 | 기능 | 권한 |
| --- | --- | --- | --- | --- |
| ME-01 | GET | /api/v1/menus | 판매 메뉴 목록 조회 | 전체 |
| ME-02 | GET | /api/v1/menus/\{menuId\} | 메뉴 상세 옵션 조회 | 전체 |
| ME-03 | GET | /api/v1/admin/menus | 관리자 메뉴 목록 검색 | STORE\_ADMIN |
| ME-04 | GET | /api/v1/admin/menus/\{menuId\} | 관리자 메뉴 상세 조회 | STORE\_ADMIN |
| ME-05 | POST | /api/v1/admin/menus | 메뉴 등록 | STORE\_ADMIN |
| ME-06 | PATCH | /api/v1/admin/menus/\{menuId\} | 메뉴 정보 옵션 수정 | STORE\_ADMIN |
| ME-07 | PATCH | /api/v1/admin/menus/\{menuId\}/sales-status | 판매 중지 재개 | STORE\_ADMIN |
| ME-08 | DELETE | /api/v1/admin/menus/\{menuId\} | 메뉴 논리 삭제 | STORE\_ADMIN |

—수정 후 ————

| ID | Method | URL 초안 | 기능 | 권한 |
| --- | --- | --- | --- | --- |
| ME-01 | GET | /api/v1/menus | 판매 메뉴 목록 조회 | 전체 |
| ME-02 | GET | /api/v1/menus/\{menuId\} | 메뉴 상세 옵션 조회 | 전체 |
| ME-03 | GET | /api/v1/admin/menus | 관리자 메뉴 목록 검색 | STORE\_ADMIN |
| ME-04 | GET | /api/v1/admin/menus/\{menuId\} | 관리자 메뉴 상세 조회 | STORE\_ADMIN |
| ME-05 | POST | /api/v1/admin/menus | 메뉴 등록 | STORE\_ADMIN |
| ME-06 | PATCH | /api/v1/admin/menus/\{menuId\} | 메뉴 정보 옵션 수정 | STORE\_ADMIN |
| ME-07 | PATCH | /api/v1/admin/menus/\{menuId\}/status | 메뉴 상태 변경 | STORE\_ADMIN |

- 메뉴 삭제하지 않고 HIDDEN 상태로 숨긴다
- 메뉴 상태 변경은 ON\_SALE, PAUSED, HIDDEN 로 표기
- 재고 중지에 따른 품절과 관리자의 판매 중지 상태는 다른 상태이다
- 메뉴 정보 = 이름, 가격, 설명, 이미지, 옵션, 판매상태 등을 포함한다
- 메뉴 등록 시 재고가 자동 생성되지 않는다

### 로컬 상세 계약 보완 (Issue #95)

위 수정 전/후 원문 표는 구분해 보존합니다. ME-01·ME-02의 카테고리·검색·정렬,
PAUSED 조회 허용·HIDDEN 비노출, 상세 옵션과 오류 계약은
[고객 메뉴 조회 구현 명세](menu-me01-me02.md)를 확인합니다.
이 링크는 로컬 구현 보완이며 Notion 원문을 변경하지 않았습니다.

## Inventory Service

| ID | Method | URL 초안 | 기능 | 권한 |
| --- | --- | --- | --- | --- |
| IN-01 | GET | /api/v1/inventory/availability | 메뉴별 주문가능 품절 여부 조회 | 전체 |
| IN-02 | GET | /api/v1/admin/inventory/items | 재고 목록 검색 재고 부족 조회 | STORE\_ADMIN |
| IN-03 | POST | /api/v1/admin/inventory/items | 재고 항목 등록 | STORE\_ADMIN |
| IN-04 | POST | /api/v1/admin/inventory/items/\{stockItemId\}/adjustments | 재고 입고 차감 | STORE\_ADMIN |
| IN-05 | PUT | /api/v1/admin/inventory/items/\{stockItemId\}/menu-link | 메뉴와 재고 연결 변경 | STORE\_ADMIN |
| IN-06 | DELETE | /api/v1/admin/inventory/items/\{stockItemId\} | 재고 항목 삭제 비활성화 | STORE\_ADMIN |

- 재고 항목은 메뉴와 독립적으로 등록 가능
- 현재 메뉴 1개와 재고 1개를 연결한다
- 연결시 menuId 와 stockItemId 를 사용한다
- 재고 미연결 또는 주문 가능 수량 0인 메뉴는 주문 불가 처리한다
- 임시 확보 수량은 시스템 내부에서 관리

## Order Service

| ID | Method | URL 초안 | 기능 | 권한 |
| --- | --- | --- | --- | --- |
| OR-01 | POST | /api/v1/orders | 임시 주문 생성 | CUSTOMER |
| OR-02 | POST | /api/v1/orders/\{orderId\}/pay | 모의 결제 요청 및 주문 확정 처리 | CUSTOMER |
| OR-03 | GET | /api/v1/orders | 본인 주문 목록 조회 | CUSTOMER |
| OR-04 | GET | /api/v1/orders/\{orderId\} | 주문 상세, 처리 상태 조회, 확보 만료 시각 조회 | CUSTOMER |
| OR-05 | POST | /api/v1/orders/\{orderId\}/cancel | 주문 취소 요청 | CUSTOMER |
| OR-06 | GET | /api/v1/admin/store/operations | 영업, 주문 접수 상태 조회 | STORE\_ADMIN |
| OR-07 | PATCH | /api/v1/admin/store/operations | 영업,주문 접수 상태 변경 | STORE\_ADMIN |
| OR-08 | GET | /api/v1/admin/orders | 관리자 주문 목록 조회, 검색 | STORE\_ADMIN |
| OR-09 | GET | /api/v1/admin/orders/\{orderId\} | 관리자 주문 상세 조회 | STORE\_ADMIN |

- 주문 API는 로그인 한 고객에게만 허용한다
- 관리자 계정은 주문 생성, 결제 기능을 사용할 수 없다
- 임시 주문 생성 시 Menu에서 가격을 재검증한 뒤 Inventory에서 재고 확보
- orderId는 임시 주문 생성 시 발급(내부 ID). 임시 주문 상태는 CREATED. 주문번호(orderNo)는 NULL이다. 결제, 재고 확정 후 고객 표시용 order\_no 발급
- 결제·재고 확정 후 OrderConfirmed 이벤트로 조리 대기열에 등록
- 확정되지 않은 주문(결제 실패·재고 부족)은 DB에 남기고 주문 목록에서 제외
- 결제 재시도 시 새 임시 주문 생성
- Cooking 장애 시 신규 주문 생성·결제 차단 (관리자 접수 설정과 별개)
- 조리 대기열 등록 전에는 주문 취소 제한
- 주문 취소 시 Cooking Service에서 취소 가능 여부를 판단 후 Order Service가 후속 처리를 한다
- OR-06, OR-07은 store\_operations(is\_open, accepting\_orders)을 조회·변경

### Order 구현 상태·추가 합의 (2026-11-17)

- **확정·구현 완료(main 병합):** Cooking 장애 시 신규 주문·결제 차단. [PR #56](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/56)은 합의된 `GET /actuator/health`(인증 없음)를 5초 주기·2초 타임아웃으로 확인하고, 3회 연속 실패 시 OR-01·OR-02에 `503 COOKING_UNAVAILABLE`을 반환합니다. 1회 성공 시 해제하며, 기동 직후 정상으로 시작합니다. 조회·확정 주문의 결제 재호출·이벤트 처리는 차단하지 않습니다. 결제를 이미 요청한 적이 있는 주문도 차단하지 않고(같은 키로 기존 결과를 확인하는 것이라 새 결제가 아님) 결과 확인·복구를 이어서 합니다. 이 수치는 해당 PR의 현재 실행 정책이며 운영 조정은 별도 합의 대상입니다.
- **확정·구현 완료(main 병합):** 조리 시작 전 취소와 Cooking의 최종 판단(CI-03)이 확정됐고, 주문 취소 API(OR-05)와 재고 복원·환불 후속 처리는 [PR #61](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/61)에서 main에 병합됐습니다. 호출 대상인 Payment(PI-03, PR #71)와 Inventory(II-03·II-04, PR #115) 구현도 main에 병합됐지만, Order와 이 서비스들을 함께 띄워 실제 연동을 확인한 것은 아직 없습니다(서비스별 가짜 서버·담당자 대조까지 확인). 처리 방식은 아래 "주문 취소(OR-05) 처리" 표를 따릅니다.
- **확정(이슈 #112, Gateway 결정 기록 2026-11-23):** Gateway가 JWT를 검증해 `X-User-Id`(JWT `sub`, 회원 ID 숫자)와 `X-User-Role`(`CUSTOMER`·`STORE_ADMIN`)을 전달하고, 서비스가 역할·소유권을 판단합니다. Order 반영은 이슈 #263입니다. 아래 "사용자 식별" 항목을 따릅니다.
- 확정된 내부 취소·재고 응답 계약은 아래 Inventory·Cooking 절을 따릅니다. Payment 환불(PI-03) 응답은 [Payment PR #71](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/71)의 구현을 확인했으며, 아래 Payment 절의 "Payment 내부 계약 확인"을 따릅니다. Payment 담당(정진혁)이 Order #61·#135 리뷰에서 호출·재시도·영구 실패 구분을 확인했고, #71은 main에 병합됐습니다.

### Order 외부 API 상세 (2026-11-18)

Order PR([#28](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/28)·[#29](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/29)·[#46](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/46)·[#52](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/52)·[#56](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/56))의 구현 기준입니다. **병합 상태(2026-11-19 기준):** #28(Flyway V1)·#29(OR-01·03·04, V2)·#46(OR-02, V3)·#52(이벤트)·#56(Cooking 장애 차단)·[#61](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/61)(OR-05 주문 취소, V4)은 main에 병합됐습니다. [#133](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/133)(OR-06·07, 이슈 #130, 아래 "관리자 API 노출 정책" 참고)·[#135](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/135)(취소 후속 처리 재시도 상한, 이슈 #125, V5)·[#142](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/142)(OR-04 조리 상태, 이슈 #140)도 main에 병합됐습니다. [#170](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/170)(OR-08·09 관리자 주문 조회, 이슈 #168, V6)도 main에 병합됐습니다(아래 "관리자 주문 조회").

| API | 요청 | 성공 응답 | 비고 |
| --- | --- | --- | --- |
| OR-01 | 본문 `{"items":[{"menuId":1,"quantity":2,"optionIds":[10]}]}`. 항목 1~20개, 수량 1~99, 옵션 최대 20개(없으면 생략·빈 배열) | `201`, 주문 상세(OR-04와 같은 형식). 상태 `CREATED`, `orderNo` 없음, `holdExpiresAt` 포함 | 접수 확인 → Cooking 장애 확인 → Menu 검증(MI-01) → 임시 주문 저장 → 재고 확보(II-01). 각 항목의 옵션 이름을 `, `로 이어붙인 길이가 255자를 넘으면 `400 INVALID_REQUEST`(Cooking이 255자 컬럼에 저장하므로 결제 뒤 조리 전표 실패를 막기 위해 주문 생성에서 거절). 금액은 Menu 응답으로 서버가 계산하며 같은 메뉴가 여러 줄이면 재고 확보는 메뉴별로 수량을 합산 |
| OR-02 | 본문 없음 | `200`, 주문 상세(`PAID`, `orderNo`, `paidAt`) | 결제(PI-01) → 재고 확정(II-02) → 주문 확정. 같은 주문에 반복 호출해도 현재 상태를 돌려주며 결제는 `idempotencyKey`(`order-{orderId}`)로 중복 방지 |
| OR-03 | 쿼리 `page`(기본 0, 음수는 0), `size`(기본 20, 1~100으로 보정) | `200`, `data`에 `items[]`(`orderId`, `orderNo`, `status`, `totalAmount`, `orderedAt`, `itemCount`, `representativeMenuName`)와 `page`, `size`, `totalElements` | 본인 주문만, 최신순. `CREATED`·`FAILED`는 제외 |
| OR-04 | 경로 `orderId` | `200`, `data`에 `orderId`, `orderNo`, `status`, `totalAmount`, `expectedWaitSec`, `orderedAt`, `paidAt`, `canceledAt`, `completedAt`, `holdExpiresAt`, `items[]`(`menuId`, `menuName`, `unitPrice`, `quantity`, `lineAmount`, `options[]`(`optionId`, `optionName`, `extraPrice`)), `cooking`(결제된 주문만, 아래 "주문 상세의 조리 상태") | 값이 없는 필드는 응답에서 생략. `holdExpiresAt`은 결제 전(`CREATED`) 주문에만 포함. 다른 사용자의 주문은 `404 ORDER_NOT_FOUND`. `expectedWaitSec`(최상위)는 주문 시점 예상 값이며 조리 상태에는 `cooking`의 필드를 쓴다 |
| OR-05 | 경로 `orderId`, 본문 없음. 본인 주문만(다른 사용자는 `404`). 부분 취소 없음 | `200`, 주문 상세(`CANCELED`, `canceledAt`). 복원·환불이 아직 안 끝났어도 `200`이고 주문은 `CANCELED` | 아래 "주문 취소(OR-05) 처리" 참고. 같은 주문의 반복 호출은 현재 상태를 돌려주고 남은 후속 처리를 이어서 함 |
| OR-06 | 본문 없음 | `200`, `data`에 `isOpen`(영업 여부), `acceptingOrders`(주문 접수 여부), `updatedAt`(마지막 변경 시각, KST) | `store_operations`(id=1) 한 행을 조회. 초기값은 영업 종료·접수 안 함. **main 병합**(PR #133, 이슈 #130)이며 인증 전에는 설정으로 꺼져 있음 |
| OR-07 | 본문 `{"isOpen":true,"acceptingOrders":true}`. 두 항목 모두 선택이며 **보낸 항목만 변경**합니다. 둘 다 없거나 값이 JSON 불린(`true`·`false`)이 아니면 `400 INVALID_REQUEST`(문자열 `"true"`·숫자 `1` 등은 변환하지 않고 거절) | `200`, 변경 후 상태(OR-06과 같은 형식) | 값이 실제로 바뀐 경우에만 `updatedAt` 갱신, 변경 전후 값은 로그로 남김(인증이 없어 변경자는 남기지 못함). 행 잠금으로 직렬화해 서로 다른 항목을 동시에 보내도 덮어쓰지 않음. 변경은 OR-01이 **다음 요청부터** 반영(`isOpen`과 `acceptingOrders`가 둘 다 true일 때만 주문 접수). 이미 만든 주문의 결제(OR-02)·조회·취소는 영향 없음 |
| OR-08 | 쿼리(모두 선택, 함께 쓰면 AND) `from`·`to`(`yyyy-MM-dd`, KST), `orderNo`, `status`, `manualReviewRequired`, `page`, `size`. 자세한 규칙은 아래 "관리자 주문 조회" | `200`, `data`에 `items[]`(`orderId`, `orderNo`, `userId`, `status`, `totalAmount`, `orderedAt`, `canceledAt`, `itemCount`, `representativeMenuName`, `manualReviewRequired`)와 `page`, `size`, `totalElements` | 모든 사용자의 주문을 최신순으로 조회. 값이 없는 필드는 응답에서 생략(`manualReviewRequired`는 항상 포함). **main 병합**(PR #170, 이슈 #168)이며 인증 전에는 설정으로 꺼져 있음 |
| OR-09 | 경로 `orderId` | `200`, `data`에 OR-04의 주문·항목 값에 더해 `userId`, `cancelReason`, `failReason`, `paymentId`, `cancelRequestedAt`, `stockRestoredAt`, `refundedAt`, `manualReviewRequired`, `manualReviewReason`, `cancelFollowUpAttempts` | 모든 사용자의 주문을 조회. 없는 주문은 `404 ORDER_NOT_FOUND`. Cooking을 호출하지 않아 `cooking`·`expectedWaitSec`·`holdExpiresAt`은 없음. 값이 없는 필드는 응답에서 생략. **main 병합**(PR #170), 인증 전에는 설정으로 꺼져 있음 |

- **관리자 API(OR-06~09) 노출 정책:** 관리자 권한(STORE_ADMIN) 확인은 신원 헤더로 구현했지만(이슈 #263), 이 헤더는 Gateway의 JWT 검증이 dev에서 확인되기 전에는 믿을 수 없으므로 설정을 켜면 **신원을 위조해 누구나** 영업을 열고 닫을 수 있고, 전체 사용자의 주문(결제 ID 포함)을 조회할 수 있습니다(OR-08·09는 `manualReviewRequired` 등 취소·환불 정보도 포함). OR-06·07과 OR-08·09는 같은 설정(`order.admin.enabled`) 하나로 함께 켜고 끕니다. 그래서 `order.admin.enabled`(환경 변수 `ORDER_ADMIN_ENABLED`, 기본 `false`)는 꺼 두는 것이 기본이고, 꺼져 있으면 경로가 없는 것처럼 `404 NOT_FOUND`입니다. **인증이 구현되기 전에는 격리된 로컬 검증 환경에서만 켜며, 외부에서 접근할 수 있거나 여러 사람이 함께 쓰는 dev와 운영(prod)에서는 켜지 않습니다.** (dev에서 테스트가 필요하면 `kubectl port-forward`처럼 클러스터 밖에서 열리지 않는 방식으로만 접근하고, Gateway 라우트에 관리자 경로가 없는지 함께 확인합니다.) Cooking 관리자 API(`COOKING_ADMIN_ENABLED`)와 같은 방식이며, 인증 적용은 #112 결정 후 별도 작업입니다. Gateway 담당(정진혁)은 Order HTTPRoute를 `/api/v1/orders` 등 필요한 경로만 등록하고 `/api/v1/admin/**`은 #112 전까지 넣지 않기로 했습니다(Cooking 관리자 API도 같은 기준). 보안 리뷰(이태훈)의 승인 범위는 "기본 비활성 임시 구현"이며, 위 조건 밖에서 켜는 것은 승인되지 않았습니다.
- **사용자 식별(이슈 #263):** `X-User-Id`(양의 정수)와 `X-User-Role`(`CUSTOMER`·`STORE_ADMIN`) 헤더를 씁니다. 클라이언트가 보낸 같은 이름의 헤더는 Gateway가 제거합니다. 두 헤더 중 하나라도 없거나 두 번 이상 오거나 형식이 틀리면 `401 UNAUTHORIZED`(형식 오류를 역할 판단보다 먼저, 요청 본문 검증보다도 먼저 확인), 고객 API(OR-01부터 OR-05까지)에 `STORE_ADMIN`이 오면 `403 FORBIDDEN`(관리자 계정은 주문·결제 불가), 관리자 API(OR-06부터 OR-09까지)에 `STORE_ADMIN`이 아니면 `403 FORBIDDEN`입니다. 다른 사용자의 주문은 기존대로 `404 ORDER_NOT_FOUND`입니다. 이 헤더는 Gateway를 거칠 때만 믿을 수 있으므로, Gateway의 JWT 검증이 dev에서 확인되고 Order 라우트가 합의되기 전에는 서비스를 외부에 직접 노출하지 않습니다.
- 주문번호(`orderNo`)는 `yyMMdd-0001` 형식(날짜별 일련번호)이며 결제·재고 확정 시 발급합니다. 형식은 Order 구현 기준이며 팀 최종 확정은 아닙니다.
- 조리 시간은 Order DB에 저장하지 않습니다. 결제를 시작할 때 Menu(MI-01)에서 다시 받아 `OrderConfirmed` 이벤트(`cookTimeSec`, 옵션 `extraCookTimeSec`)에 담아 Cooking에 전달합니다.

**관리자 주문 조회 (OR-08·09, PR #170, 이슈 #168)**

가게 관리자가 전체 사용자의 주문을 조회해 문의 대응·환불 확인에 씁니다. 읽기 전용이며 외부 서비스를 호출하지 않습니다. **인증(STORE_ADMIN)이 확정되기 전(이슈 #112)이라 기본으로 꺼져 있고(`ORDER_ADMIN_ENABLED=false`) 꺼져 있으면 `404 NOT_FOUND`입니다.** 격리된 로컬 검증 환경에서만 켜며, 공유 dev·prod와 실제 화면 연동에서는 켜지 않습니다(위 "관리자 API 노출 정책"). 프론트엔드는 인증 연결 전에는 공유 환경의 실제 API에 이 화면을 연결하지 않는 전제입니다.

OR-08 검색 조건 (모두 선택, 함께 쓰면 AND)

| 파라미터 | 설명 |
| --- | --- |
| `from`, `to` | 주문 시각(`orderedAt`) 기준 날짜(`yyyy-MM-dd`, KST, 양 끝 포함). 한 번에 최대 31일 |
| `orderNo` | 주문번호 정확히 일치(앞뒤 공백은 무시, 빈 값은 없는 것으로 봄) |
| `status` | `CREATED`·`PAID`·`WAITING`·`COOKING`·`COMPLETED`·`CANCELED`·`FAILED`(대소문자 무관) |
| `manualReviewRequired` | `true`면 수동 확인이 필요한 주문만. `false`와 생략은 같은 일반 조회(거르지 않음) |
| `page`, `size` | 0부터 시작(음수는 0), 기본 20개, 1~100개로 보정(고객 목록 OR-03과 같은 한도). 정렬은 주문 시각 최신순(같으면 `id` 내림차순)이며 바꿀 수 없음 |

- **기간 기본값:** 기간을 주지 않으면 **최근 31일**, `from`만 주면 `from`부터 31일, `to`만 주면 `to`까지 31일로 채웁니다. 시작이 종료보다 늦거나 31일을 넘으면 `400 INVALID_REQUEST`입니다.
- **주문번호로 전체 기간 검색:** `orderNo`만 보내고 `from`·`to` 쿼리 파라미터를 **아예 보내지 않으면**(파라미터 자체를 생략) 기간 제한 없이 전체에서 찾습니다(주문번호는 유일). `orderNo`와 함께 `from` 또는 `to`를 보내면 그 기간 안에서만 찾습니다. 화면에서 주문번호를 입력했다면 `from`·`to`를 요청에서 빼야 합니다. 빈 값(`from=`)을 보냈을 때의 동작은 이 문서가 보장하지 않으니 생략하세요.
- 임시 주문(`CREATED`·`FAILED`)도 포함하며 `status`로 거를 수 있습니다(고객 목록은 숨김).
- `userId`만 응답합니다. Order는 이름·연락처를 갖고 있지 않습니다.

**수동 확인 필요(`manualReviewRequired`):** 취소한 주문의 재고 복원·환불이 자동 재시도로 풀리지 않아 사람이 확인해야 하는 상태입니다(위 "후속 처리 재시도 상한"). 지표 `order_cancel_follow_up_manual_required`와 같은 기준이며, 후속 처리가 모두 끝나면 `false`로 돌아갑니다. 결제 후 환불이 필요한데 실패해 `FAILED`로 끝난 주문(`failReason`이 `*_REFUND_NEEDED`)은 포함하지 않으며 상세의 `failReason`으로 구분합니다.

응답 읽는 법 (프론트엔드 참고)

- **목록과 상세의 역할이 다릅니다.** 목록(OR-08)은 `manualReviewRequired` 배지를 표시하는 데 쓰고, 사유(`manualReviewReason`)·`refundedAt`·`stockRestoredAt`·`failReason`·`paymentId`는 **상세(OR-09)에서만** 읽습니다.
- **값이 없으면 JSON 키가 생략됩니다**(`null`로 내려오지 않음). 예: 임시 주문은 `orderNo`가 없고, 취소하지 않은 주문은 `canceledAt`이 없으며, 수동 확인이 아니면 `manualReviewReason`이 없습니다. `manualReviewRequired`(불린)와 `cancelFollowUpAttempts`(숫자), 금액·수량은 항상 포함됩니다.
- 상세의 `refundedAt`·`stockRestoredAt`이 없으면 아직 안 끝났거나 대상이 아닌 경우입니다. `cancelRequestedAt`이 남아 있으면 Cooking 응답을 모른 채 취소 확인이 진행 중일 수 있습니다.
- 주문 상태 `FAILED`의 환불 필요 여부는 상세의 `failReason`(`*_REFUND_NEEDED`)으로 따로 표시합니다.
- 모든 시각은 KST(`+09:00`) 오프셋 형식입니다.

예시 (값은 설명용. 세 예시는 같은 날의 같은 데이터이며, 항목은 `orderedAt` 최신순(같으면 `id` 내림차순)으로 나옵니다)

예시 1. `GET /api/v1/admin/orders?from=2026-11-20&to=2026-11-20&manualReviewRequired=true` → **수동 확인이 필요한 주문만** 나옵니다(여기서는 주문 44, 41 두 건).

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "orderId": 44,
        "orderNo": "261120-0005",
        "userId": 12,
        "status": "CANCELED",
        "totalAmount": 9000,
        "orderedAt": "2026-11-20T10:40:12+09:00",
        "canceledAt": "2026-11-20T10:42:30+09:00",
        "itemCount": 1,
        "representativeMenuName": "불고기버거",
        "manualReviewRequired": true
      },
      {
        "orderId": 41,
        "orderNo": "261120-0003",
        "userId": 7,
        "status": "CANCELED",
        "totalAmount": 26500,
        "orderedAt": "2026-11-20T10:15:30+09:00",
        "canceledAt": "2026-11-20T10:18:02+09:00",
        "itemCount": 2,
        "representativeMenuName": "치즈버거",
        "manualReviewRequired": true
      }
    ],
    "page": 0,
    "size": 20,
    "totalElements": 2
  },
  "message": "OK"
}
```

예시 2. `GET /api/v1/admin/orders?from=2026-11-20&to=2026-11-20` (`manualReviewRequired`를 생략하거나 `false`로 보내도 같은 결과) → **일반 조회**로 그날의 모든 주문이 나옵니다(주문 44, 42, 41 세 건). 두 번째 줄의 주문 42는 임시 주문(`CREATED`)이라 `orderNo`·`canceledAt` 키가 **생략**된 모습을 보여 줍니다.

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "orderId": 44,
        "orderNo": "261120-0005",
        "userId": 12,
        "status": "CANCELED",
        "totalAmount": 9000,
        "orderedAt": "2026-11-20T10:40:12+09:00",
        "canceledAt": "2026-11-20T10:42:30+09:00",
        "itemCount": 1,
        "representativeMenuName": "불고기버거",
        "manualReviewRequired": true
      },
      {
        "orderId": 42,
        "userId": 9,
        "status": "CREATED",
        "totalAmount": 6000,
        "orderedAt": "2026-11-20T10:21:10+09:00",
        "itemCount": 1,
        "representativeMenuName": "감자튀김",
        "manualReviewRequired": false
      },
      {
        "orderId": 41,
        "orderNo": "261120-0003",
        "userId": 7,
        "status": "CANCELED",
        "totalAmount": 26500,
        "orderedAt": "2026-11-20T10:15:30+09:00",
        "canceledAt": "2026-11-20T10:18:02+09:00",
        "itemCount": 2,
        "representativeMenuName": "치즈버거",
        "manualReviewRequired": true
      }
    ],
    "page": 0,
    "size": 20,
    "totalElements": 3
  },
  "message": "OK"
}
```

예시 3. `GET /api/v1/admin/orders?orderNo=261120-0003` → `orderNo`만 보내고 `from`·`to`를 생략했으므로 전체 기간에서 찾습니다. 응답 모양은 예시 1의 주문 41 한 줄과 같고 `totalElements`는 1입니다.

예시 4. `GET /api/v1/admin/orders/41` → 상세(환불이 안 끝난 취소 주문 예). 목록(예시 1·2)의 주문 41과 같은 주문이며 `itemCount` 2와 `items` 2개가 일치합니다. 환불 시각(`refundedAt`)이 없고 사유가 있습니다.

```json
{
  "success": true,
  "data": {
    "orderId": 41,
    "orderNo": "261120-0003",
    "userId": 7,
    "status": "CANCELED",
    "totalAmount": 26500,
    "orderedAt": "2026-11-20T10:15:30+09:00",
    "paidAt": "2026-11-20T10:16:05+09:00",
    "canceledAt": "2026-11-20T10:18:02+09:00",
    "cancelReason": "CUSTOMER_CANCEL",
    "paymentId": 1041,
    "stockRestoredAt": "2026-11-20T10:18:03+09:00",
    "manualReviewRequired": true,
    "manualReviewReason": "REFUND_NOT_REFUNDABLE",
    "cancelFollowUpAttempts": 1,
    "items": [
      {
        "menuId": 3,
        "menuName": "치즈버거",
        "unitPrice": 8500,
        "quantity": 2,
        "lineAmount": 20000,
        "options": [
          { "optionId": 10, "optionName": "치즈 추가", "extraPrice": 1500 }
        ]
      },
      {
        "menuId": 5,
        "menuName": "감자튀김",
        "unitPrice": 6000,
        "quantity": 1,
        "lineAmount": 6500,
        "options": [
          { "optionId": 21, "optionName": "소스 추가", "extraPrice": 500 }
        ]
      }
    ]
  },
  "message": "OK"
}
```

값 계산 규칙: `lineAmount` = (`unitPrice` + 옵션 `extraPrice` 합계) × `quantity`, `totalAmount` = 항목 `lineAmount`의 합입니다(위 예: (8500+1500)×2 + (6000+500)×1 = 26500). 목록의 `itemCount`는 수량 합계가 아니라 항목(`items`) 수이고, `representativeMenuName`은 첫 항목의 메뉴 이름입니다.

수동 확인 이유(`manualReviewReason`) 값: `REFUND_NOT_REFUNDABLE`(환불 영구 실패), `RESTORE_NOT_APPLICABLE`(재고 복원 영구 실패), `RETRY_LIMIT_EXCEEDED`(재시도 상한 도달). 인덱스(V6)와 적용 시 주의는 ERD 문서를 참고합니다.

**Order 오류 코드 (구현 기준)**

| HTTP | errorCode | 의미 |
| --- | --- | --- |
| 400 | `INVALID_REQUEST` | 요청 값 오류. 관리자 목록(OR-08)에서는 기간 형식·31일 초과·시작이 종료보다 늦음·상태 값 오류도 포함 |
| 401 | `UNAUTHORIZED` | 신원 헤더(`X-User-Id`·`X-User-Role`)가 없거나 중복이거나 형식이 틀림(Gateway 우회 대비 방어, Gateway 자체의 JWT 검증 실패 401과 구분) |
| 403 | `FORBIDDEN` | 역할 부족(고객 API에 `STORE_ADMIN`, 관리자 API에 `STORE_ADMIN`이 아닌 역할) |
| 404 | `ORDER_NOT_FOUND` | 없는 주문 또는 다른 사용자의 주문(관리자 상세 OR-09는 없는 주문만) |
| 404 | `NOT_FOUND` | 관리자 API(OR-06~09)가 설정(`order.admin.enabled`)으로 꺼져 있어 경로가 존재하지 않음 |
| 409 | `STORE_NOT_ACCEPTING_ORDERS` | 매장 영업 종료·주문 미접수 |
| 409 | `MENU_NOT_AVAILABLE` | 판매할 수 없는 메뉴·옵션 포함 |
| 409 | `OUT_OF_STOCK` | 재고 부족 |
| 409 | `ORDER_NOT_PAYABLE` | 결제할 수 없는 상태의 주문 |
| 409 | `ORDER_PAY_IN_PROGRESS` | 같은 주문의 결제를 다른 요청이 처리 중. 잠시 후 주문 상태 확인 |
| 409 | `HOLD_EXPIRED` | 재고 확보 시간이 지나 주문 종료 |
| 409 | `ORDER_NOT_CANCELABLE` | 취소할 수 없는 주문(조리 완료·실패 주문, 결제 전 주문의 확보가 이미 확정된 이상 상태) |
| 409 | `ORDER_PAYMENT_PENDING` | 결제를 요청한 적이 있어 결제가 됐을 수 있는 주문은 취소하지 않음. 결제를 다시 호출해 결과 확인 |
| 409 | `COOKING_ALREADY_STARTED`, `COOKING_ALREADY_DONE` | Cooking이 조리 시작·완료로 취소를 거절 |
| 409 | `COOKING_ORDER_PENDING` | Cooking이 아직 주문을 접수 처리하지 못함(CI-03 404). 잠시 후 다시 시도 |
| 409 | `STOCK_CONFIRM_FAILED` | 결제 후 재고 확정이 거부되어 환불 후 주문 종료 |
| 402 | `PAYMENT_FAILED` | 결제 실패 확정. 주문 종료, 새 주문으로 재시도 |
| 502 | `UPSTREAM_INVALID_RESPONSE` | 연동 서비스 응답 오류. 결과를 알 수 없는 상태를 성공·실패로 단정하지 않음 |
| 503 | `MENU_SERVICE_UNAVAILABLE`, `INVENTORY_SERVICE_UNAVAILABLE`, `PAYMENT_SERVICE_UNAVAILABLE` | 연동 서비스 장애·시간 초과. 결제·재고 확정 결과를 모를 때는 주문을 `CREATED`로 두고, 같은 주문으로 다시 호출하면 이어서 처리 |
| 503 | `COOKING_UNAVAILABLE` | Cooking 장애로 신규 주문·결제 차단 |
| 503 | `COOKING_SERVICE_UNAVAILABLE` | 주문 취소 중 Cooking 응답을 받지 못함(결과 불명). 주문을 그대로 두고, 요청은 접수되어 재호출하거나 스케줄러가 확인해 자동 처리 |
| 500 | `INTERNAL_ERROR` | 서버 내부 오류 |

**주문 상세의 조리 상태 (OR-04 `cooking`, PR #142, 이슈 #140)**

결제된 주문(`PAID`·`WAITING`·`COOKING`·`COMPLETED`)의 상세 응답에 `cooking` 객체가 붙습니다. 결제 전(`CREATED`)·실패(`FAILED`)·취소(`CANCELED`) 주문에는 없습니다. Order는 Cooking CI-02를 호출해 값을 그대로 전하며 Order의 `status`를 바꾸지 않습니다. 화면 구성·문구·폴링 주기는 프론트엔드가 정합니다. 주문 목록(OR-03)은 바뀌지 않습니다.

| 필드 | 설명 |
| --- | --- |
| `lookup` | `OK`(조리 정보 있음) / `PENDING`(결제 후 조리 전표 등록 대기, Cooking `404 COOKING_TICKET_NOT_FOUND`) / `UNAVAILABLE`(Cooking 장애·시간 초과·계약과 다른 응답) |
| `status` | `WAITING` / `COOKING` / `DONE` / `CANCELED` |
| `waitingAhead`, `estimatedCookSec` | 내 앞 대기 수, 이 주문의 예상 조리 시간(초) |
| `expectedWaitSec` | 지금부터 **조리 시작까지**(초). 대기 중이 아니면 0 |
| `expectedReadySec` | 지금부터 **조리 완료까지**(초). 조리 중은 남은 시간, 완료·취소는 0 |
| `startedAt` | 조리 시작 시각(KST) |

- `lookup`이 `OK`가 아니면 조리 정보 필드는 모두 생략합니다. 조회 실패·시간 초과(연결 1초·응답 2초)에도 주문 상세는 `200`입니다. 응답의 `orderId`가 요청한 주문과 다르거나 없으면 계약 위반으로 보고 `UNAVAILABLE`로 처리합니다.
- **표시 우선순위(프론트 기준, 서버 동작 변경 없음):** Order `CANCELED`·`FAILED`는 그대로, `COMPLETED`는 완료, 그 외(`PAID`)는 `lookup`이 `OK`일 때 Cooking 상태를 우선하고 `PENDING`·`UNAVAILABLE`이면 해당 문구를 표시합니다. Order `PAID`인데 Cooking이 `CANCELED`이면 취소 처리 중일 수 있으니 "취소 처리 중"으로 보이고 Order 상태를 계속 확인합니다. Cooking이 `DONE`이어도 Order가 `COMPLETED`가 될 때까지 폴링을 멈추지 않습니다.
- **Cooking 계약 변경:** Cooking CI-02가 `expectedWaitSec`=조리 시작까지, `expectedReadySec`=조리 완료까지로 바뀌었고(PR #141, 이슈 #139, main 병합) `expectedReadySec`는 항상 내려옵니다. 변경 전 응답(`expectedReadySec` 없음, `expectedWaitSec`=완료까지)을 같은 의미로 바꾸던 Order의 임시 변환 분기는 후속 작업(이슈)으로 제거합니다. 그때까지 프론트는 위 표만 따르면 됩니다.
- 프론트엔드(이은제)의 계약 승인을 받았습니다. 폴링 주기·부하와 실제 Cooking↔Order 통합 확인은 후속입니다.

**주문 취소(OR-05) 처리** (PR #61·#135, main 병합)

| 주문 상태·상황 | 처리 |
| --- | --- |
| `CREATED`(결제를 요청한 적 없음) | 재고 확보만 해제(II-03)하고 `CANCELED`. 환불·Cooking 호출 없음. 이미 만료·해제된 확보도 성공 |
| `CREATED`인데 결제를 요청한 적이 있음 | 취소하지 않고 `409 ORDER_PAYMENT_PENDING` |
| 결제 전 주문의 확보가 이미 확정됨(II-03 409) | 임의로 취소하지 않고 `409 ORDER_NOT_CANCELABLE`, 수동 확인 |
| `PAID` 이후, Cooking이 취소 수락(CI-03 200) | `CANCELED`(`cancel_reason`=`CUSTOMER_CANCEL`, `canceled_at`, 상태 이력) 후 재고 복원(II-04)·환불(PI-03) |
| Cooking `409 COOKING_ALREADY_STARTED`·`COOKING_ALREADY_DONE` | 취소하지 않고 같은 코드로 응답 |
| Cooking `404 COOKING_TICKET_NOT_FOUND` | 접수 처리 중일 수 있어 취소로 보지 않고 `409 COOKING_ORDER_PENDING` |
| Cooking 응답을 모름(5xx·타임아웃) | 주문을 그대로 두고 `503 COOKING_SERVICE_UNAVAILABLE`. Cooking을 호출하기 직전에 `cancel_requested_at`을 기록해 두므로, 고객이 다시 호출하지 않아도 스케줄러가 CI-03을 다시 호출해 확정한다(Cooking 취소는 멱등). 조리 시작·완료·접수 전으로 거절되면 기록을 지우고 더 확인하지 않음 |
| 재고 복원 또는 환불 실패 | 주문은 `CANCELED` 유지, 응답은 `200`. 끝난 단계를 `stock_restored_at`·`refunded_at`에 기록하고 안 끝난 단계는 같은 주문 재호출 또는 스케줄러(30초)가 이어서 처리. 두 단계는 서로 독립 |
| 재고 복원 `409 RESTORE_NOT_APPLICABLE` | 성공으로 기록하지 않고 에러 로그(영구 실패), 수동 확인 대상(Inventory가 "이후에도 CONFIRMED로 바뀌지 않아 재호출해도 결과가 같다"고 확인, PR #135 리뷰) |
| 환불 `409 PAYMENT_NOT_REFUNDABLE`·그 밖의 4xx(없는 결제 `404` 포함)·계약과 다른 응답 | 성공으로 기록하지 않고 에러 로그(영구 실패), 수동 확인 대상(`5xx`·시간 초과만 재시도 대상, Payment 담당 확인) |
| 후속 처리 재시도 상한 (PR #135, 이슈 #125) | 실패마다 횟수를 늘리고 다음 시도를 점점 늦춥니다(30초에서 두 배씩, 최대 1시간). 기본 상한은 **12번**(`cancel.follow-up.max-attempts`)이며 닿으면 `cancel_follow_up_manual_reason=RETRY_LIMIT_EXCEEDED`로 "수동 확인 필요"를 표시하고 스케줄러 대상에서 뺍니다. **남은 단계가 모두 영구 실패**(`RESTORE_NOT_APPLICABLE`·`REFUND_NOT_REFUNDABLE`·계약과 다른 응답)이면 상한을 기다리지 않고 바로 표시하며, 한 단계가 영구 실패여도 다른 단계(예: 환불)가 재시도로 풀릴 수 있으면 자동 재시도를 계속합니다. 표시되는 순간 에러 로그 한 줄(`orderId`, `orderNo`, `paymentId`, `reason`)을 남기고 지표 `order_cancel_follow_up_manual_required`(수동 확인이 필요한 미완료 취소 주문 수)를 `/actuator/prometheus`로 노출합니다. 같은 주문의 취소를 다시 호출하면 남은 단계를 이어서 처리합니다 |
| 수동 확인 알림 | 알림 조건 제안은 `max(order_cancel_follow_up_manual_required) > 0`(1분 지속, warning)이며 Pod마다 같은 DB를 세므로 합계가 아니라 `max`로 묶습니다. DB 장애 중에는 지표가 비어 보일 수 있습니다. 실제 Grafana 규칙은 모니터링 담당(김지윤)이 플랫폼 설치 후 설정합니다(이슈 #138). 운영 방법(조회·재개 SQL)은 서비스 README에 있습니다 |
| 남은 한계 (PR #135) | ① **Cooking 응답을 모른 채 남은 취소 요청**(`cancel_requested_at`)의 재확인에는 아직 상한이 없습니다(주문이 `PAID`로 남아 조리가 계속되므로 돈·재고 손실은 없습니다). ② 실제 Grafana 알림 규칙은 아직 설정되지 않았습니다. ③ 수동 확인 주문은 관리자 주문 조회(OR-08·09, PR #170)의 `manualReviewRequired`로 찾을 수 있지만, 처리(재개·완료 표시) 기능은 없습니다(재개는 같은 주문의 취소 재호출 또는 서비스 README의 SQL) |
| `COMPLETED`·`FAILED` | `409 ORDER_NOT_CANCELABLE` |
| 이미 `CANCELED` | 현재 상태 반환(멱등), 남은 후속 처리가 있으면 이어서 처리 |
| 결제 중이거나 다른 취소가 처리 중 | `409 ORDER_PAY_IN_PROGRESS`(결제와 같은 처리 독점 사용) |

**결제 후 실패 처리**

| 상황 | 처리 |
| --- | --- |
| 결제 실패 확정 | 주문 `FAILED`(`PAYMENT_FAILED`), 재고 해제. 재시도는 새 주문 |
| 재고 확보 시간 만료(결제를 요청한 적 없음) | 결제하지 않고 주문 `FAILED`(`HOLD_EXPIRED`). 재시도는 새 주문 |
| 결제를 요청한 적이 있는 주문이 재시도 중 확보 만료 | 종료하지 않고 같은 `idempotencyKey`로 결제 결과를 확인. 성공이면 재고 확정을 시도하고, 거절되면 환불 후 `FAILED`(`STOCK_CONFIRM_FAILED`), 결과를 계속 모르면 `CREATED` 유지 + `503` |
| 결제를 요청한 적이 있는 주문이 재시도 중 메뉴 판매 중지 | 결제 결과를 확인해 성공이면 환불 후 `FAILED`(`MENU_NOT_AVAILABLE`). 환불 실패 시 `MENU_NOT_AVAILABLE_REFUND_NEEDED`로 기록해 수동 확인 |
| 재시도 중 같은 키의 결제가 이미 환불됨(`REFUNDED`) | 돈이 이미 돌아간 상태라 다시 환불하지 않고 `FAILED`(`PAYMENT_REFUNDED`)로 종료, 재고 반환 |
| 결제 성공 후 재고 확정 거부 | 결제 취소(환불) 후 `FAILED`(`STOCK_CONFIRM_FAILED`). 환불까지 실패하면 `STOCK_CONFIRM_FAILED_REFUND_NEEDED`로 기록해 수동 확인 |
| 결제 직전 Menu에서 판매 중지 확인 | 결제하지 않고 주문 종료(`MENU_NOT_AVAILABLE`), 재고 반환 |
| 재고 확보 후 확보 ID 저장 실패(OR-01) | 재고 해제를 시도하고 `FAILED`(`HOLD_SAVE_FAILED`). 해제 실패 시 Inventory 만료에 맡김 |
| 결제·재고 확정 결과 불명(시간 초과, 5xx) | 성공·실패를 정하지 않고 `CREATED` 유지, `503`. 같은 주문으로 다시 호출하면 같은 결제 키로 이어서 처리 |

## Cooking Service

| ID | Method | URL 초안 | 기능 | 권한 |
| --- | --- | --- | --- | --- |
| CO-01 | GET | /api/v1/cooking/congestion | 현재 혼잡도, 대기 주문 수, 예상 대기시간 | 전체 |
| CO-02 | POST | /api/v1/cooking/estimates | 선택한 메뉴의 예상 대기, 조리시간 계산 | 전체 |
| CO-03 | GET | /api/v1/admin/cooking/overview | 대기, 조리 중, 완료 건수 등 현황 조회 | STORE\_ADMIN |
| CO-04 | GET | /api/v1/admin/cooking/queue | FIFO 대기열, 주문 번호, 접수 시각, orderId 조회 | STORE\_ADMIN |

#### 참고

- CO-02: 요청/응답·계산식·실패 코드(Menu 4xx → 409 `MENU_NOT_AVAILABLE`)는 [CO-02 구현 명세](cooking-co02.md)를 확인합니다. 이 링크는 로컬 보완이며 Notion 원문은 변경하지 않았습니다.

# 내부 API 초안

## Menu Service

| ID | Method | URL 초안 | 호출자 | 기능 |
| --- | --- | --- | --- | --- |
| MI-01 | POST | /internal/v1/menus/validate-purchase | Order, Cooking | 메뉴,옵션,가격,판매 가능 상태 검증 |
| MI-02 | GET | /internal/v1/menus/\{menuId\}/existence | Inventory | 재고 연결 시 메뉴 존재 여부 확인 |

#### 참고

- MI-01: 메뉴 상태가 `ON_SALE`인지 확인하고, 선택한 옵션과 최신 가격을 검증합니다. Order·Cooking 요청/응답·조리시간·현재 오류 매핑은 [MI-01 구현 명세](menu-mi01.md)를 확인합니다.

- MI-02: Inventory가 재고를 메뉴에 연결할 때 메뉴가 실제 존재하는지 확인합니다. 최신 로컬 구현 계약·오류 매핑과 미존재 응답 제안은 [MI-02 구현 명세](menu-mi02.md)를 확인합니다. 이 링크는 로컬 보완이며 Notion 원문은 변경하지 않았습니다.

### Menu 내부 계약 확인 (2026-11-18)

MI-01의 요청·응답은 [Menu PR #90](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/90)(2026-11-18 main 병합)에서 Menu 담당자가 확인한 계약입니다. **확정·병합:** 상세 요청·응답·오류는 [MI-01 구현 명세](menu-mi01.md)를 따르며, 아래는 Order 호출 관점의 요약입니다. 메뉴·옵션별 세부 오류 코드와 400/404/409 구분은 아직 합의되지 않았습니다.

| 구분 | 내용 |
| --- | --- |
| 요청 | `{"items":[{"menuId":10,"quantity":2,"optionIds":[1,2]}]}`. 옵션이 없으면 빈 배열 |
| 성공 응답 | `200`, 요청 순서대로 `data.items[]`에 `menuId`, `menuName`, `unitPrice`, `cookTimeSec`, `options[]`(`optionId`, `optionName`, `extraPrice`, `extraCookTimeSec`)를 반환. 예: `{"success":true,"data":{"items":[{"menuId":1,"menuName":"버거","unitPrice":6500,"cookTimeSec":90,"options":[{"optionId":3,"optionName":"세트","extraPrice":2500,"extraCookTimeSec":30}]}]},"message":"OK"}`. `unitPrice`는 옵션·수량을 뺀 메뉴 1개 가격, `cookTimeSec`는 메뉴 1개 조리 시간(초), `extraCookTimeSec`는 선택 옵션 1개 추가 조리 시간(초) |
| 오류 | 요청 오류·구매 불가(판매 중이 아닌 메뉴, 비활성 옵션)는 `400 INVALID_REQUEST`, 저장 데이터 오류·내부 장애는 `500 INTERNAL_ERROR`. 재고는 확인하지 않음 |
| Order 호출측 | 주문 생성과 **결제 직전**에 각각 호출. 4xx는 `409 MENU_NOT_AVAILABLE`, 연결 실패·5xx는 `503 MENU_SERVICE_UNAVAILABLE`로 변환. 조리 시간은 Order DB에 저장하지 않고 `OrderConfirmed`에 담아 전달 |

- 품절 판단: 재고 수량은 Menu가 아닌 Inventory Service에서 확인합니다.

## Inventory Service

| ID | Method | URL 초안 | 호출자 | 기능 |
| --- | --- | --- | --- | --- |
| II-01 | POST | /internal/v1/inventory/holds | Order | 임시 주문 기준 재고 5분 확보 |
| II-02 | POST | /internal/v1/inventory/holds/\{holdId\}/confirm | Order | 결제 성공 후 임시 확보 재고 확정 차감 |
| II-03 | DELETE | /internal/v1/inventory/holds/\{holdId\} | Order | 결제 실패·취소 시 임시 확보 재고 반환 |
| II-04 | POST | /internal/v1/inventory/restorations | Order | 결제·재고 확정 후 주문 취소 시 재고 복원 |

- 임시 확보 만료시각과 중복 요청 방지 필요

#### 참고

- II-01: `orderId`, `menuId`, `quantity` 등을 전달합니다. 중복 확보를 막고, 실제 재고(`stock_qty`)에서 이미 임시 확보된 수량(`reserved_qty`)을 제외하여 주문 가능 수량을 확인하고, 중복 확보를 방지합니다.
- II-02: 확보 상태가 유효한 경우에만 재고를 확정 차감합니다. 이미 확정된 요청은 중복 차감하지 않습니다.
- II-03: 확보한 재고를 반환합니다. 이미 해제한 재고가 중복 반환되지 않도록 처리합니다.
- II-04: 결제 후 확정된 주문을 취소할 때 실제 재고를 복원합니다. 동일 주문의 중복 복원을 방지해야 합니다.

#### 요약

- 기존 내부 HTTP API: 4개 유지
- 내부 HTTP API: 0개 삭제
- 신규 내부 HTTP API: 0개 추가
- 주요 보완: 임시 주문 ID(`orderId`) 연동, 재고 확보 시간 기본 5분·테스트 10초 적용, 중복 확보·차감·복원 방지

### Inventory 내부 계약 보완 (2026-11-17)

아래 오류 의미와 복원 요청은 [PR #61의 Inventory 담당자 합의](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/61)를 반영합니다. **확정·구현 완료(main 병합):** Inventory 초기 구성(PR #70)과 내부 API 구현([PR #115](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/115))이 병합됐습니다. 다만 Order와 함께 띄운 실제 연동 확인은 아직 없습니다. II-03·II-04 응답은 담당자(남규리)가 PR #115 구현과 대조해 확인했습니다.

| API | 확정된 요청·응답 의미 | Order 호출측 현황 |
| --- | --- | --- |
| II-01 | `409 INSUFFICIENT_STOCK`, `409 STOCK_NOT_LINKED`는 확보 불가 | 두 업무 오류를 Order의 `409 OUT_OF_STOCK`으로 변환. 고객 응답 코드는 그대로 두고, 본문 errorCode를 읽어 원인별로 지표(`order_inventory_hold_rejected_total`의 `reason`)·경고 로그(`STOCK_NOT_LINKED`)로 구분한다(#270). 모르는 errorCode·본문 없음도 `OUT_OF_STOCK`으로 변환하고 `reason=unknown`으로 센다 |
| II-02 | `409 HOLD_NOT_ACTIVE`는 만료·해제, `404 HOLD_NOT_FOUND`는 확보 없음 | 위 두 HTTP 상태만 `409 STOCK_CONFIRM_FAILED`로 해석. 결제 후라면 환불·주문 종료로 이어짐. 다른 4xx는 `502 UPSTREAM_INVALID_RESPONSE`, 5xx·연결 실패는 `503 INVENTORY_SERVICE_UNAVAILABLE`이며 결과 불명 상태를 임의로 실패 확정하지 않음 |
| II-03 | 본문 없는 DELETE. 이미 만료·해제됐어도 200, 확정된 확보는 409, 없는 확보는 404 | 현재 release 호출은 모든 RestClientException을 `503 INVENTORY_SERVICE_UNAVAILABLE`로 변환. 취소 흐름에서의 세부 오류 해석은 후속 구현 필요 |
| II-04 | `POST /internal/v1/inventory/restorations`, 본문 `{"orderId":1}`. 복원 불가 시 `409 RESTORE_NOT_APPLICABLE` | Order 호출 구현은 PR #61(main 병합): 200만 성공(`RESTORED`), 409는 복원 불가로 성공 기록 안 함, 그 밖의 4xx는 `502`, 5xx·연결 실패는 재시도 대상. Inventory 담당(남규리)이 [Inventory PR #115](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/115) 구현과 대조해 확인: 성공 시 `200 {orderId, restored: true}`, 이미 복원된 주문도 같은 `200`, 복원 불가는 `409 RESTORE_NOT_APPLICABLE`, 추가 오류 코드는 요청 형식 오류 `400`뿐 |

II-01의 다음 JSON은 **Order 호출측 PR의 현행 제안**입니다. Inventory 제공자와 요청·응답 전체가 확정됐다는 근거는 없으므로 구현 전에 상호 확인합니다.

```json
{"orderId":1,"items":[{"menuId":10,"quantity":2}]}
```

```json
{"success":true,"data":{"holdId":100,"expiresAt":"2026-11-17T12:05:00+09:00"},"message":"OK"}
```

Order는 `holdId`와 `expiresAt`을 필수로 읽고 II-02·II-03에 holdId를 사용합니다. 기본 확보 5분·테스트 10초는 기존 확정 설계이며, II-02·II-03 성공 본문은 현재 호출측에서 읽지 않습니다. 성공 본문이 불필요하다는 계약 확정과는 구분합니다.

## Payment Service

| ID | Method | URL 초안 | 호출자 | 기능 |
| --- | --- | --- | --- | --- |
| PI-01 | POST | /internal/v1/payments | Order | 모의 결제 요청 및 중복 결제 방지 |
| PI-02 | GET | /internal/v1/payments/\{paymentId\} | Order | 결제 결과 및 상태 조회 |
| PI-03 | POST | /internal/v1/payments/\{paymentId\}/refund | Order | 결제 취소·환불 처리 및 중복 환불 방지 |

- 중복 결제 방지 정책 필요

#### 참고

- PI-01: `orderId`, 결제 금액, `idempotencyKey`를 전달합니다. 동일 요청이 반복되더라도 중복 결제되지 않도록 처리합니다.
- PI-02: 결제 응답이 지연되거나 누락된 경우 기존 결제 결과를 확인하는 데 사용합니다.
- PI-03: 주문 취소 시 환불을 처리합니다. 환불 상태 및 기존 환불 이력을 확인하여 동일 요청의 중복 환불을 방지하며, 구체적인 처리 방식은 정해지지 않았습니다.
- 결제 기록: `payments.order_id`에 UNIQUE 제약을 적용해 주문당 결제 기록을 최대 1건으로 제한합니다.
- 재시도: 결제 실패가 확정되면 기존 임시 주문을 종료하고 새로운 임시 주문을 생성합니다.

#### 요약

- 기존 내부 API: 3개 모두 유지
- 신규 API: 없음
- 주요 보완: 중복 결제 방지, 결제 결과 재확인, 중복 환불 방지

### Payment 내부 계약 확인 (2026-11-18)

PI-01·PI-03은 [Payment PR #71](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/71)의 구현을 확인한 내용입니다. **구현 완료(main 병합, PR #71):** Payment 담당(정진혁)이 PI-01의 요청·응답 형식·4xx 의미·같은 키 재시도 방식(Order #46 리뷰)과 PI-03 환불 호출·재시도 방식(Order #61 리뷰)을 확인했습니다. 위 PI-03의 "구체적인 처리 방식은 정해지지 않았습니다"는 이 구현과 담당자 확인으로 대체됩니다.

| API | 요청·응답 | Order 호출측 |
| --- | --- | --- |
| PI-01 | 요청 `{"orderId":1,"amount":4500,"idempotencyKey":"order-1"}`. 응답 `{"paymentId":1,"status":"SUCCESS"}`이며 `status`는 `SUCCESS`·`FAILED`, 그리고 이미 환불된 결제를 같은 키로 다시 호출했을 때의 `REFUNDED`. 같은 `idempotencyKey` 재요청은 처음 결과를 `200`으로 반환(환불 뒤에는 `REFUNDED`). `409 IDEMPOTENCY_KEY_CONFLICT`(같은 키에 다른 주문·금액), `409 PAYMENT_ALREADY_EXISTS`(이미 결제 기록이 있는 주문), `400 INVALID_REQUEST` | 키는 `order-{orderId}`. `FAILED`는 `402 PAYMENT_FAILED`로 주문 종료. `REFUNDED`는 돈이 이미 돌아간 상태라 다시 환불하지 않고 `FAILED`(`PAYMENT_REFUNDED`)로 종료. 4xx는 결과를 알 수 없으므로 `502 UPSTREAM_INVALID_RESPONSE`, 5xx·시간 초과는 `503 PAYMENT_SERVICE_UNAVAILABLE`로 두고 주문은 `CREATED` 유지 |
| PI-02 | `GET`, 응답은 PI-01과 같은 형식. 없는 `paymentId`는 `404 PAYMENT_NOT_FOUND` | 현재 Order는 호출하지 않음 |
| PI-03 | `POST /internal/v1/payments/{paymentId}/refund`, 응답 `{"paymentId":1,"status":"REFUNDED"}`. 이미 환불된 결제도 `200`. `404 PAYMENT_NOT_FOUND`, `409 PAYMENT_NOT_REFUNDABLE`(승인되지 않은 결제) | 결제 후 재고 확정 거부 시 호출하고, 주문 취소(OR-05, main 병합)의 후속 처리에서도 호출합니다. **Order의 응답 해석:** `200`이면서 본문이 `status: REFUNDED`이고 `paymentId`가 같을 때만 환불됨으로 봅니다(이미 환불된 결제도 같은 `200`이라 재호출이 안전). `409 PAYMENT_NOT_REFUNDABLE`·그 밖의 4xx(없는 결제 `404` 등)·계약과 다른 응답은 다시 호출해도 결과가 같으므로 성공으로 기록하지 않고 에러 로그로 남겨 수동 확인하며, `5xx`·시간 초과만 재시도 대상입니다 |

## Cooking Service

| ID | Method | URL 초안 | 호출자 | 기능 |
| --- | --- | --- | --- | --- |
| CI-02 | GET | /internal/v1/cooking/orders/\{orderId\} | Order | 주문별 조리 상태, 예상시간 조회 |
| CI-03 | POST | /internal/v1/cooking/orders/\{orderId\}/cancel | Order | 취소 가능 여부 확인 및 대기열에서 제거 |

### Cooking 내부 계약 보완 (2026-11-17)

조리 시작·완료는 별도 HTTP API가 아니라 Cooking 스케줄러가 자동 처리하는 설계입니다. CI-01 등록 API는 삭제 상태이며 EV-01로만 전표를 생성합니다.

**CI-03 — 확정, Cooking 구현 병합(PR #62), Order 호출은 PR #61(main 병합):** [Order 합의 #61](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/61), [Cooking 구현 #62](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/62). 요청 본문은 없으며 응답은 공통 응답 형식을 사용합니다.

| 현재 전표 상태 | HTTP·결과 |
| --- | --- |
| WAITING | 200, CANCELED로 변경하고 canceled_at 기록 |
| CANCELED | 같은 200 응답. 반복 취소는 멱등 처리 |
| COOKING | 409 COOKING_ALREADY_STARTED |
| DONE | 409 COOKING_ALREADY_DONE |
| 전표 없음(EV-01 처리 전 포함) | 404 COOKING_TICKET_NOT_FOUND. Order는 접수 처리 중으로 안내하고 취소 확정을 하지 않음 |

```json
{"success":true,"data":{"orderId":1,"status":"CANCELED"},"message":"OK"}
```

PR #62(main 병합)는 전표를 `PESSIMISTIC_WRITE` 행 잠금으로 읽고 상태를 재확인합니다. 자동 조리 시작도 같은 잠금 안에서 상태를 확인해야 하며, 자동 조리 진행은 [PR #78](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/78)(main 병합)에서 구현됐습니다. 취소와 자동 조리 시작의 경합을 실제 DB로 검증하는 통합 테스트는 후속 이슈 #114입니다.

**CI-02 — 구현 완료(main 병합: PR #53·#141), 팀 전체 확정은 미확인:** [PR #53](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/53)은 `orderId`, `orderNo`, `status`, `waitingAhead`, `estimatedCookSec`, `expectedWaitSec`, `queuedAt`, `startedAt`, `completedAt`, `canceledAt`을 반환하는 안을 제시했고, #139에서 CO-01·CO-02와 뜻을 맞추며 `expectedReadySec`를 추가했습니다. null 시각은 생략되며, 전표가 없으면 `404 COOKING_TICKET_NOT_FOUND`입니다. `expectedWaitSec`는 **조리 시작까지**(WAITING: 현재 조리 잔여 + 앞 대기 전표 예상 조리 시간 합, 그 외 0), `expectedReadySec`는 **조리 완료까지**(WAITING: `expectedWaitSec` + `estimatedCookSec`, COOKING: 자기 남은 조리 시간, DONE·CANCELED: 0)의 예상 시간(초)입니다. 이 계산식·필드 전체의 팀 확정은 확인되지 않았습니다.

CO-04의 WAITING 대기열은 `queued_at, id` 오름차순입니다. 관리자 권한은 설계상 STORE_ADMIN이나 현재 Cooking PR에는 검사 TODO가 남아 있으므로 권한 검증 완료로 보지 않습니다.

#### RabbitMQ 이벤트

이벤트 목록은 [별도 이벤트 명세](../events/notion-draft.md)에서 관리합니다.

#### 처리 규칙

- CI-01 삭제: 조리 대기열 등록은 HTTP API가 아닌 `OrderConfirmed` 이벤트로 처리합니다.
- CI-03: 조리 대기(`WAITING`) 상태에서만 취소 버튼을 활성화하며, 취소 요청 시 Cooking Service가 현재 상태를 재확인하여 취소 가능 여부를 판단합니다.
- 이벤트 중복 방지: `outbox_events`, `processed_events` 테이블을 활용합니다.
- FIFO 기준: RabbitMQ에 메시지가 들어온 순서가 아니라 Cooking DB에 실제 등록된 순서를 사용합니다.

#### 요약

- 내부 HTTP API: 2개 유지
- 내부 HTTP API: 1개 삭제
- RabbitMQ 이벤트: 2개 별도 추가

<br><br>논의 부분

orderId와 holdId의 상세 요청·응답 연결 — 위 Inventory 절의 호출측 제안과 확정 오류 의미를 구분하여 확인

- **Order 구현(main 병합) (2026-11-18, [PR #46](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/46)):** 임시 주문 생성 때 `orderId`로 확보를 요청하고 응답의 `holdId`·`expiresAt`을 `orders.hold_id`·`hold_expires_at`에 저장합니다. 결제 후 확정(II-02)과 실패·취소 시 해제(II-03)에는 `holdId`를 씁니다. II-01·II-02·II-03의 오류 의미는 위 Inventory 절의 합의(2026-11-16)를 따르고, 요청·응답 전체는 제공자 확인 전입니다.

재고 확보 유효시간은 기본 5분·테스트 10초(STOCK\_HOLD\_TTL). 만료 처리의 상세 계약은 별도 보완

- **Order 구현(main 병합):** 만료 시각은 Inventory가 정해 응답하고, Order는 결제 전에 만료 여부를 확인해 만료면 주문을 종료(`409 HOLD_EXPIRED`)합니다. 만료된 재고의 실제 반환은 Inventory 담당입니다. 만료 후 `CREATED`로 남은 주문의 정리 방식은 미정이며, 별도 작업으로 다룹니다.

결제 요청 중복 방지 방법

- **Order 구현(main 병합):** 결제는 `idempotencyKey`(`order-{orderId}`)로 중복을 막고, 주문 확정은 행 잠금과 상태 확인으로 한 번만 처리합니다. Payment PR #71은 같은 키의 재요청에 처음 결과를 돌려주고 다른 주문·금액이면 `409 IDEMPOTENCY_KEY_CONFLICT`, 주문당 결제 1건을 적용합니다(위 Payment 절). PI-02(결제 조회)는 응답 전에는 `paymentId`를 알 수 없어, 같은 키 재시도로 대체하므로 Order가 호출하지 않습니다.

결제 성공 이후 후속 실패시 복구 방식

- **Order 구현(main 병합):** 위 Order Service 절의 "결제 후 실패 처리" 표를 따릅니다. 재고 확정이 거부되면 결제를 취소(PI-03)하고 주문을 종료하며, 환불까지 실패하면 `STOCK_CONFIRM_FAILED_REFUND_NEEDED`로 기록해 수동 확인합니다. 결제·재고 확정 결과를 알 수 없을 때는 주문을 `CREATED`로 두고 같은 주문으로 다시 호출하면 이어서 처리합니다. 같은 주문의 `pay`가 동시에 들어오면 한 요청만 처리 독점(`orders.pay_lock_until`, 60초)을 잡아 Menu·Payment·Inventory를 호출하고, 나머지는 외부 호출 없이 현재 상태(확정 결과·`ORDER_NOT_PAYABLE`·`409 ORDER_PAY_IN_PROGRESS`)로 응답합니다. 독점을 잡은 뒤 주문 상태를 다시 읽으므로 이미 확정된 주문을 환불하지 않습니다. 독점은 요청마다 고유 토큰을 가지며, 결제·환불·재고 확정 직전에 연장하면서 아직 내 것인지 확인하고 상태 변경도 토큰이 일치할 때만 반영합니다. 독점이 만료돼 다른 요청이 이어받았다면 이전 요청은 아무것도 하지 않고 `409 ORDER_PAY_IN_PROGRESS`로 멈춥니다. 결제를 요청하기 직전에 `orders.payment_requested_at`을 기록하고 결제 성공 직후 `payment_id`를 저장하므로, 응답이 유실돼도 "결제가 됐을 수 있는 주문"을 구분합니다. **한계:** 결제 성공 후 주문 확정 저장이 실패해도 같은 방식으로 재호출해야 하며 자동 재시도·정산 배치는 없습니다. 결제 요청이 Payment에 닿지 않았던 경우 재호출이 새 결제가 될 수 있으나 확정 단계에서 거절되면 바로 환불합니다. 팀 확정 전입니다.
