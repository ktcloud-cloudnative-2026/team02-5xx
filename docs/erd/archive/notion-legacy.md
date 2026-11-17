# 보관용 옛 ERD — 현재 구현 기준으로 사용하지 않음

> Notion 원문의 초안을 보관한 문서입니다. Git에 추가했다는 이유로 팀 승인·구현 완료를 의미하지 않습니다.

- 원본: [ERD 초안](https://app.notion.com/p/4102f07e947880fb87eac2ab3ffc68a2)
- 원본 최종 수정: 2026-11-13T03:41:37.090Z (UTC)
- 가져온 날짜: 2026-11-13 (Asia/Seoul)
- 공통 확정 규칙: [CLAUDE.md](../../../CLAUDE.md)
- 변경 범위: 문서 형식 변환·자료 분리. API 경로, 필드, 테이블, 상태 및 미결정 사항은 원문을 유지합니다.

---

> 이 자료는 원문에서 이미 과거 설계로 구분되어 있습니다. 서비스 구성·테이블명 등에 현행 규칙과 다른 내용이 있으므로 현재 구현에 적용하지 않습니다.

## 1. ERD가 뭔가요?

ERD(Entity Relationship Diagram)는 **DB에 어떤 표를 만들고, 표끼리 어떻게 이어지는지** 그린 설계도입니다.

| ERD 용어 | 쉽게 말하면 | 예시 |
| --- | --- | --- |
| 테이블(표) | 엑셀 시트 한 장 | `orders` = 주문 시트 |
| 컬럼 | 시트의 열(칸 제목) | `order_number`, `status` |
| 행 | 시트의 한 줄 = 데이터 1건 | 주문 1건 |
| 관계(연결선) | 시트끼리 "이 줄은 저 줄과 관련 있음" | 주문 1건에 주문 항목 여러 개 |

## 2. 그림 읽는 법

| 표시 | 뜻 |
| --- | --- |
| **PK** (Primary Key) | 한 줄을 구분하는 번호. 주민번호처럼 겹치지 않음 |
| **FK** (Foreign Key) | 다른 표의 PK를 가리키는 칸. DB가 "없는 번호는 못 넣게" 막아 줌 |
| **UK** (Unique Key) | 표 안에서 같은 값이 두 번 들어갈 수 없는 칸 |
| **실선** | 같은 서비스 DB 안의 진짜 연결(FK 있음) |
| **점선** | 다른 서비스 표의 ID만 적어 둔 것(FK 없음, 필요하면 API로 물어봄) |
| 선 끝이 **새발(여러 갈래)** 모양 | "여러 개" 쪽. 예: 주문 1건 ↔ 주문 항목 여러 개 |
| 선 끝이 **동그라미 + 막대** | "없거나 1개" 쪽. 예: 결제 시도 1건 ↔ 주문 0\~1건 |

## 3. ERD

표가 20개라 한 장에 다 넣으면 글자가 너무 작아져서, **전체 지도 1장 + 서비스별 상세 6장**으로 나눴습니다. 코드 블록 위 보기 방식을 **미리 보기**로 바꾸면 그림이 보이고, 표를 고치려면 해당 블록의 코드를 직접 수정하면 됩니다.

### 3-1. 전체 지도 — 서비스와 연결만

표 안의 칸은 빼고 **어떤 표가 어느 서비스에 있고, 서로 어떻게 이어지는지**만 보여 줍니다. 실선은 같은 DB 안의 FK, 점선은 서비스 간 ID 참조입니다. (이벤트용 표 `outbox_event`, `processed_event`는 3-4, 3-5에)

```mermaid
flowchart LR
  subgraph M["메뉴 DB · menu_svc"]
    menu["menu<br/>메뉴"] --> menu_option["menu_option<br/>옵션"]
  end
  subgraph O["주문 DB · order_svc"]
    inventory["inventory<br/>재고"]
    payment_attempt["payment_attempt<br/>결제 시도"] --> reservation_item["reservation_item<br/>임시 확보 항목"]
    payment_attempt --> orders["orders<br/>주문"]
    orders --> order_item["order_item<br/>주문 항목"]
    store_status["store_status<br/>접수 스위치"]
  end
  subgraph C["조리 DB · cooking_svc"]
    cooking_ticket["cooking_ticket<br/>조리 전표"]
  end
  subgraph G["혼잡도 DB · congestion_svc"]
    threshold["congestion_threshold<br/>혼잡 기준값"]
    snapshot["congestion_snapshot<br/>혼잡 기록"]
  end
  subgraph A["회원 DB · auth_svc"]
    users["users<br/>회원"] --> social_account["social_account<br/>소셜 계정"]
  end
  menu -. menu_id .-> inventory
  users -. user_id .-> payment_attempt
  orders -. order_id .-> cooking_ticket
```

### 3-2. 메뉴 (menu\_svc)

```mermaid
erDiagram
  menu {
    bigint id PK "메뉴 ID"
    bigint store_id "매장 ID"
    varchar name "메뉴 이름"
    text description "설명"
    int price "기본 가격(원)"
    int base_cook_seconds "기본 조리 시간(초)"
    varchar image_url "이미지 주소"
    boolean is_active "판매 여부"
    timestamptz created_at "만든 시각"
    timestamptz updated_at "고친 시각"
  }
  menu_option {
    bigint id PK "옵션 ID"
    bigint menu_id FK "메뉴 ID"
    varchar name "옵션 이름"
    int extra_price "추가 금액(원)"
    boolean is_active "판매 여부"
  }
  menu ||--o{ menu_option : "옵션 여러 개"
```

### 3-3. 주문·재고 (order\_svc) — 핵심 흐름

결제하기를 누르면 `payment_attempt`와 `reservation_item`이 생기고, 결제에 성공하면 `orders`와 `order_item`이 생깁니다. `inventory`는 메뉴 ID로만 메뉴 서비스를 가리킵니다.

```mermaid
erDiagram
  inventory {
    bigint id PK "재고 ID"
    bigint store_id "매장 ID"
    bigint menu_id "메뉴 ID (FK 없음)"
    int on_hand "실제 재고"
    int reserved "결제 중 잡아 둔 수량"
    timestamptz updated_at "고친 시각"
  }
  payment_attempt {
    bigint id PK "결제 시도 ID"
    bigint store_id "매장 ID"
    bigint user_id "회원 ID (FK 없음)"
    varchar idempotency_key UK "중복 결제 방지 키"
    varchar status "RESERVED CONFIRMED FAILED CANCELLED EXPIRED"
    int total_amount "총 금액(원)"
    timestamptz expires_at "만료 시각"
  }
  reservation_item {
    bigint id PK "항목 ID"
    bigint attempt_id FK "결제 시도 ID"
    bigint menu_id "메뉴 ID (FK 없음)"
    varchar menu_name "메뉴 이름 (복사)"
    int unit_price "단가 (복사)"
    int cook_seconds "조리 시간 (복사)"
    int quantity "수량"
  }
  orders {
    bigint id PK "주문 ID"
    bigint store_id "매장 ID"
    int order_number "주문번호 (전광판)"
    bigint attempt_id FK "결제 시도 ID (UK)"
    bigint user_id "회원 ID (FK 없음)"
    varchar status "CONFIRMED COOKING COMPLETED CANCELLED"
    int total_amount "총 금액(원)"
    timestamptz cancelled_at "취소 시각"
  }
  order_item {
    bigint id PK "항목 ID"
    bigint order_id FK "주문 ID"
    bigint menu_id "메뉴 ID (FK 없음)"
    varchar menu_name "메뉴 이름"
    int unit_price "단가"
    int quantity "수량"
  }
  payment_attempt ||--o{ reservation_item : "잡아 둔 메뉴"
  payment_attempt ||--o| orders : "성공하면 주문 1건"
  orders ||--o{ order_item : "주문 항목"
```

옵션 칸(`option_id`, `option_name`)과 `created_at`, `updated_at`은 그림을 단순하게 하려고 뺐습니다. 전체 칸은 dbdiagram 원본에 있습니다.

### 3-4. 주문 서비스의 운영·이벤트 표 (order\_svc)

```mermaid
erDiagram
  store_status {
    bigint store_id PK "매장 ID"
    boolean accepting_orders "주문 접수 여부"
    varchar reason "사유"
    bigint changed_by "바꾼 관리자 ID"
    timestamptz changed_at "바꾼 시각"
  }
  outbox_event {
    bigint id PK "이벤트 ID"
    varchar event_type "이벤트 종류"
    jsonb payload "내용"
    varchar status "PENDING SENT"
    timestamptz sent_at "보낸 시각"
  }
  processed_event {
    varchar event_id PK "이벤트 ID"
    timestamptz processed_at "처리 시각"
  }
```

### 3-5. 조리 (cooking\_svc)

```mermaid
erDiagram
  cooking_ticket {
    bigint id PK "전표 ID (FIFO 순서)"
    bigint store_id "매장 ID"
    bigint order_id UK "주문 ID (FK 없음)"
    int order_number "주문번호 (전광판)"
    int cook_seconds "조리 시간(초)"
    varchar status "WAITING COOKING DONE CANCELLED"
    timestamptz queued_at "대기 등록 시각"
    timestamptz started_at "조리 시작"
    timestamptz done_at "조리 완료"
    int version "동시 변경 방지"
  }
  outbox_event {
    bigint id PK "이벤트 ID"
    varchar event_type "이벤트 종류"
    jsonb payload "내용"
    varchar status "PENDING SENT"
    timestamptz sent_at "보낸 시각"
  }
  processed_event {
    varchar event_id PK "이벤트 ID"
    timestamptz processed_at "처리 시각"
  }
```

### 3-6. 혼잡도 (congestion\_svc)

```mermaid
erDiagram
  congestion_threshold {
    bigint store_id PK "매장 ID"
    int busy_waiting_count "혼잡 기준 (대기 건수)"
    int saturated_waiting_count "포화 기준 (대기 건수)"
    bigint updated_by "바꾼 관리자 ID"
    timestamptz updated_at "바꾼 시각"
  }
  congestion_snapshot {
    bigint id PK "기록 ID"
    bigint store_id "매장 ID"
    varchar level "SMOOTH BUSY SATURATED"
    int waiting_count "대기 건수"
    int avg_wait_seconds "평균 대기(초)"
    int recent_order_count "최근 5분 주문 수"
    timestamptz measured_at "측정 시각"
  }
```

### 3-7. 회원 (auth\_svc)

```mermaid
erDiagram
  users {
    bigint id PK "회원 ID"
    varchar login_id UK "아이디"
    varchar password_hash "비밀번호 해시"
    varchar name "이름"
    varchar role "CUSTOMER SUPER_ADMIN OPS_ADMIN STORE_ADMIN"
    bigint store_id "담당 매장 (매장 관리자만)"
    varchar status "ACTIVE DISABLED"
    bigint created_by "만든 최고 관리자 ID"
    timestamptz last_login_at "마지막 로그인"
  }
  social_account {
    bigint id PK "소셜 계정 ID"
    bigint user_id FK "회원 ID"
    varchar provider "google kakao"
    varchar provider_user_id "제공자 쪽 회원 ID"
  }
  users ||--o{ social_account : "소셜 계정"
```
