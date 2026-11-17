# API 명세 초안 — Notion 가져오기

> Notion 원문의 초안을 보관한 문서입니다. Git에 추가했다는 이유로 팀 승인·구현 완료를 의미하지 않습니다.

- 원본: [API 명세 초안](https://app.notion.com/p/4102f07e9478802f91a4da2ae18ab56f)
- 원본 최종 수정: 2026-11-13T03:36:25.198Z (UTC)
- 가져온 날짜: 2026-11-13 (Asia/Seoul)
- 공통 확정 규칙: [CLAUDE.md](../../CLAUDE.md)
- 변경 범위: 문서 형식 변환·자료 분리. API 경로, 필드, 테이블, 상태 및 미결정 사항은 원문을 유지합니다.

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

## Cooking Service

| ID | Method | URL 초안 | 기능 | 권한 |
| --- | --- | --- | --- | --- |
| CO-01 | GET | /api/v1/cooking/congestion | 현재 혼잡도, 대기 주문 수, 예상 대기시간 | 전체 |
| CO-02 | POST | /api/v1/cooking/estimates | 선택한 메뉴의 예상 대기, 조리시간 계산 | 전체 |
| CO-03 | GET | /api/v1/admin/cooking/overview | 대기, 조리 중, 완료 건수 등 현황 조회 | STORE\_ADMIN |
| CO-04 | GET | /api/v1/admin/cooking/queue | FIFO 대기열, 주문번호, 접수 시각 조회<br><br>FIFO 대기열, 주문 번호, 접수 시각, orderId 조회 | STORE\_ADMIN |

# 내부 API 초안

## Menu Service

| ID | Method | URL 초안 | 호출자 | 기능 |
| --- | --- | --- | --- | --- |
| MI-01 | POST | /internal/v1/menus/validate-purchase | Order | 메뉴,옵션,가격,판매 가능 상태 검증 |
| MI-02 | GET | /internal/v1/menus/\{menuId\}/existence | Inventory | 재고 연결 시 메뉴 존재 여부 확인 |

#### 참고

- MI-01: 메뉴 상태가 `ON_SALE`인지 확인하고, 선택한 옵션과 최신 가격을 검증합니다.

- MI-02: Inventory가 재고를 메뉴에 연결할 때 메뉴가 실제 존재하는지 확인합니다.

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

## Cooking Service

| ID | Method | URL 초안 | 호출자 | 기능 |
| --- | --- | --- | --- | --- |
| CI-02 | GET | /internal/v1/cooking/orders/\{orderId\} | Order | 주문별 조리 상태, 예상시간 조회 |
| CI-03 | POST | /internal/v1/cooking/orders/\{orderId\}/cancel | Order | 취소 가능 여부 확인 및 대기열에서 제거 |

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

orderId와 holdId의 상세 요청·응답 연결

재고 확보 유효시간은 기본 5분·테스트 10초(STOCK\_HOLD\_TTL). 만료 처리의 상세 계약은 별도 보완

결제 요청 중복 방지 방법

결제 성공 이후 후속 실패시 복구 방식
