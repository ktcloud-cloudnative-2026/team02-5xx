# RabbitMQ 이벤트 초안 — Notion 가져오기

> 기존 Notion 초안의 구조를 유지하며 확인된 최신 합의를 반영합니다. 확정 설계와 구현 상태는 구분하며, 미확정 사항은 구현 기준으로 삼지 않습니다.

- 원본: [API 명세 초안](https://app.notion.com/p/4102f07e9478802f91a4da2ae18ab56f)
- 원본 최종 수정: 2026-11-16T03:27:49.697Z (UTC)
- 가져온 날짜: 2026-11-13 (Asia/Seoul)
- 공통 확정 규칙: [CLAUDE.md](../../CLAUDE.md)
- 최근 계약 확인: 2026-11-17. Notion 최신 API·ERD와 관련 Order·Cooking PR의 합의 및 코드를 대조했습니다. 아래에 별도 표시하지 않은 기존 초안의 승인 상태는 유지합니다.
- 구현 기준(작성 당시, 2026-11-13): main `4fbbb66`에는 관련 업무 API·Flyway·이벤트 처리가 아직 없었습니다.
- 구현 기준(현재, 2026-11-18): main `7e736f4`에는 Order Flyway V1·V2와 주문 생성·조회 API(PR #28·#29)가 병합되어 있습니다. 이벤트 발행·수신(PR #52)은 병합 전이며, 열린 PR의 구현을 main 반영 완료로 표시하지 않습니다.

---

> HTTP API와 구분해 관리합니다. 아래 상세는 2026-11-16 Order·Cooking 담당자 합의를 명시한 PR #52·#57을 기준으로 최신화했습니다. 계약은 확정됐지만 관련 PR은 아직 열려 있으며, main에서 실제 연동이 완료된 상태는 아닙니다.

| ID | 이벤트명 | 발신자 | 수신자 | 기능 |
| --- | --- | --- | --- | --- |
| EV-01 | OrderConfirmed | Order | Cooking | 확정 주문을 조리 대기열에 등록 |
| EV-02 | CookingCompleted | Cooking | Order | 조리 완료를 주문 상태에 반영 |

관련 HTTP API와 처리 규칙은 [API 초안](../api/notion-draft.md), 이벤트 저장·중복 방지 흐름은 [ERD 초안](../erd/notion-draft.md)을 함께 확인합니다.

## 확정된 브로커 계약

근거: [Order PR #52의 합의 표](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/52), [Cooking PR #57](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/57), [Notion 최신 API](https://app.notion.com/p/4102f07e9478802f91a4da2ae18ab56f). **확정·구현 중**이며 main의 큐 생성·배포 완료를 뜻하지 않습니다.

| 구분 | 이름·속성 |
| --- | --- |
| 업무 Exchange | peakorder.events — topic, durable, autoDelete=false |
| DLX | peakorder.dlx — direct, durable, autoDelete=false |
| EV-01 Routing Key / Queue | order.confirmed / cooking.order-confirmed (Cooking 선언) |
| EV-01 DLQ | cooking.order-confirmed.dlq |
| EV-02 Routing Key / Queue | cooking.completed / order.cooking-completed (Order 선언) |
| EV-02 DLQ | order.cooking-completed.dlq |
| 큐·DLQ | 모두 durable. 업무 큐에 x-dead-letter-exchange=peakorder.dlx, x-dead-letter-routing-key=업무 큐 이름 |
| DLQ 바인딩 | DLX에 업무 큐 이름을 Routing Key로 사용해 해당 .dlq를 바인딩 |
| 메시지 | persistent, JSON·camelCase, messageId=본문 eventId(UUID) |

Exchange는 양 서비스가 같은 이름·속성으로 선언합니다. 각 서비스는 자기 수신 큐·DLQ를 선언합니다. 스키마 버전·추가 헤더의 공통 계약은 확인되지 않았으므로 새 필드를 만들지 않습니다.

## EV-01 OrderConfirmed

- Publisher: Order. 결제·재고 확정과 주문 PAID·orderNo 발급, Outbox PENDING 저장을 같은 주문 확정 트랜잭션으로 처리합니다.
- Consumer: Cooking. 조리 전표와 항목을 WAITING으로 생성합니다.
- 확정 메시지 필드와 형태(값은 예시):

```json
{
  "eventId": "00000000-0000-4000-8000-000000000001",
  "orderId": 1,
  "orderNo": "261117-0001",
  "userId": 7,
  "confirmedAt": "2026-11-17T12:00:00+09:00",
  "items": [
    {
      "menuId": 10,
      "menuName": "메뉴 예시",
      "quantity": 2,
      "cookTimeSec": 120,
      "options": [
        {"optionId": 11, "optionName": "옵션 예시", "extraCookTimeSec": 30}
      ]
    }
  ]
}
```

Cooking 저장 규칙은 `cook_time_sec = cookTimeSec + Σ options.extraCookTimeSec`(1개 기준), `option_summary = optionName을 ", "로 연결`(옵션 없으면 NULL), `estimated_cook_sec = Σ(cook_time_sec × quantity)`입니다. queued_at은 confirmedAt이 아니라 **Cooking DB 등록 시각**입니다. 현재 PR은 FIFO를 queued_at, id 순으로 조회합니다.

수신 트랜잭션은 ① processed_events에 eventId 삽입(중복이면 업무 처리 없이 종료) → ② 전표·항목 생성 → ③ 커밋 후 ack입니다. cooking_tickets.order_id UNIQUE가 두 번째 중복 방지 장치입니다. Cooking PR은 다른 eventId로 같은 orderId가 다시 오면 경고 후 무시합니다.

**DTO 확인:** [Order 발행 DTO `cfe5a88`](https://github.com/ktcloud-cloudnative-2026/team02-5xx/blob/cfe5a884d7d9b7133f0f99f1094d0000593f51fd/services/order-service/src/main/java/com/peakorder/order/messaging/OrderConfirmedEvent.java)의 Option은 `optionId`, `optionName`, `extraCookTimeSec`를 선언하며, 이벤트 생성 시 주문 옵션의 이름을 전달합니다. [Cooking 수신 DTO `16eb587`](https://github.com/ktcloud-cloudnative-2026/team02-5xx/blob/16eb58742a003bda9029f664020519691f00d996/services/cooking-service/src/main/java/com/peakorder/cooking/messaging/OrderConfirmedEvent.java)에도 같은 필드가 존재합니다. optionName 누락에 따른 DTO 불일치는 없습니다. 이는 지정한 커밋의 코드 확인 결과이며 main 병합이나 실제 종단 간 연동 완료를 의미하지 않습니다.

## EV-02 CookingCompleted

- Publisher: Cooking. 조리 완료(DONE·completed_at)와 Outbox 저장 후 발행합니다. CANCELED 전표에는 발행하지 않습니다.
- Consumer: Order. processed_events 기록·주문 COMPLETED 변경·완료 시각·상태 이력을 같은 트랜잭션에서 처리합니다.

```json
{
  "eventId": "00000000-0000-4000-8000-000000000002",
  "orderId": 1,
  "completedAt": "2026-11-17T12:05:00+09:00"
}
```

completedAt은 ISO 8601(+09:00)입니다. Order PR은 PAID·WAITING·COOKING인 주문을 완료 처리하고, 이미 처리한 eventId는 무시합니다. 취소·미확정 주문 등 처리 불가능한 상태는 아래 재시도 분류를 따릅니다.

**확정·미구현 범위:** 확인한 Cooking PR #62에는 자동 조리 시작·완료 스케줄러와 CookingCompleted 발행기가 아직 없습니다. Order의 수신 구현만 존재하므로 양방향 연동 완료로 보지 않습니다. Order의 중간 WAITING·COOKING 상태 반영 방식도 미확정입니다.

## 발행·재시도·DLQ

| 상황 | 합의 및 확인된 PR 처리 |
| --- | --- |
| 발행 성공 판정 | publisher confirm을 받고 라우팅 실패 반환이 없는 경우에만 Outbox SENT |
| 브로커 장애·확인 타임아웃·라우팅할 큐 없음 | PENDING 유지 후 재발행. 최소 한 번 전달이므로 수신자 멱등 처리 필수 |
| 일시적 수신 오류 | 최초 포함 최대 3회, 1초·2초 간격. 소진 시 reject(requeue=false)로 DLQ |
| JSON 형식 오류·필수값 누락·잘못된 값·존재하지 않는 주문·처리 불가능한 상태 | 재시도 없이 DLQ. PR의 ListenerRetryPolicy는 Jackson/변환·IllegalArgumentException·IllegalStateException 계열을 분류하며, 존재하지 않는 주문(`orderId`에 해당하는 주문 없음)은 재시도해도 결과가 같아 IllegalArgumentException으로 바로 DLQ로 보냄(Cooking 리뷰 반영, 2026-11-18) |
| 정상·중복 수신 | 업무 트랜잭션 완료 후 ack. 처리 실패의 중복 방지 기록도 같은 트랜잭션에서 롤백 |
| DLQ 감시 | 합의: 메시지 수 > 0이 1분 지속하면 Grafana 알림. 모니터링 구성 후 적용할 항목이며 배포 완료는 확인되지 않음 |

Order PR의 발행 주기 1초·배치 50개·confirm 대기 5초는 현재 구현값입니다. Cooking 발행기의 동일값 채택이나 영구 실패 Outbox의 운영 복구·DLQ 재처리 절차는 미확정입니다. 무조건 재주입하거나 새 eventId로 바꾸는 정책을 임의로 추가하지 않습니다.
