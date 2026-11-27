# Cooking·RabbitMQ·모니터링·로깅 통합 테스트 — 김지윤

- 담당: Cooking Service, RabbitMQ 이벤트 연동(Outbox·DLQ), 모니터링(Prometheus·Grafana·알림), 로깅(Loki·Alloy)
- 공동 테스트 주관: **CT-06** 이벤트 중복·지연·FIFO·조리 상태, **CT-08** 장애 복구·로그·메트릭·알림
- 상태 값: NOT RUN / IN PROGRESS / PASS / FAIL / BLOCKED / RETEST
- 목적: 단위 테스트 반복이 아니라 dev 환경에서 서비스 간 연동과 전체 흐름을 확인한다.

## 테스트 환경

| 항목 | 값 |
|---|---|
| 환경 | dev (`https://peakorder-dev.jpexstudio.com`, Gateway `10.10.22.100`) |
| Cooking 이미지 | `sha-6219d6b…` (11/26 기준, #370) |
| Cooking 설정 | HPA min 1·max 3·CPU 70% (#332), 종료 유예 50초·preStop 10초 (#316), 관리자 API dev 공개 (#349) |
| RabbitMQ | `rabbitmq-0`, 업무 큐 `cooking.order-confirmed`·`order.cooking-completed`와 각 DLQ |
| 모니터링 | kube-prometheus-stack 93.2.2 (`monitoring-dev`, 수동 Sync), 알림 규칙 `rabbitmq-dlq`·`outbox-pending`·`service-health` |
| 로깅 | Loki 21.3.1·Alloy 1.15.0 (`logging-dev`), 보관 3일 확정(하루 약 3.5MiB(peakorder), 3일 약 0.01GiB / PVC 5Gi, 11/26 16:05 실측) |
| 테스트 계정 | 관리자 `admin-demo@peakorder.test`(STORE_ADMIN), 고객 `customer-demo@peakorder.test` (#379, 비밀번호는 기록하지 않음) |
| 조회 도구 | Grafana Explore(Prometheus·Loki, port-forward), `kubectl`(조회 위주), `rabbitmqadmin`(Pod 안, DLQ 조회는 반드시 `--ack-mode ack_requeue_true` — 기본값은 메시지 삭제) |

- 로그인 API는 `Origin` 헤더를 검사한다. Auth는 HTTPS Origin(또는 http localhost)만 허용하므로 Gateway IP(`http://10.10.22.100`)를 Origin으로 쓰면 403이다. dev 도메인 Origin으로 로그인 200 확인(11/26, K-03). 개인 PC(WSL)에서는 Gateway IP에 닿지 않지만 dev 도메인(Cloudflare 경유)으로 API 시험이 가능하다.
- 비밀번호는 `read -s`로 입력하고, 토큰·비밀값은 출력·기록하지 않는다.

## 선행 조건

| 조건 | 상태 | 비고 |
|---|---|---|
| 주문 접수 켜짐 | 충족 | 11/26 14:19 Order 담당이 OR-07로 `isOpen=true`·`acceptingOrders=true` 설정(#399 병합 후, Discord 공지). **복원은 12/2 발표 종료 후**(팀장님 결정 11/26 5번 — 시연·리허설 고려). 초기값은 둘 다 false라 주문이 409 `STORE_NOT_ACCEPTING_ORDERS` |
| 전 서비스 dev 최신 이미지·`Synced Healthy` | 확인 필요 | 시험 시작 시 기록 |
| 시작 상태: 업무 큐 consumers ≥ 1, DLQ 0, Outbox 미발행 0 | 확인 필요 | 시험 시작 시 기록 |
| ServiceMonitor 6개 서비스 | 충족 | 11/26 16:00 #401 Sync (O-01) |
| 장애 주입 전 cp available 1Gi 이상 | — | 300Mi 미만이면 중단. Discord 사전 공유·시간 조율, 종료 후 복원 |

## 1. Cooking Service

| ID | 내용 | 상태 | 실제 결과 | 근거 | 일시 |
|---|---|---|---|---|---|
| K-01 | 주문 확정 → 조리 전표 등록(대기) → 조리 중 → 예정 시각 완료. 주문 상세(OR-04)의 `cooking`(CI-02)이 단계별로 일치 | PASS | `261126-0004`(클래식 버거, 조리 180초): 결제 `PAID` 15:21:31 → `lookup PENDING`(EV-01 도착 전) → 15:21:42 `COOKING` 남은 시간 170초 → 10~12초 간격 조회마다 같은 만큼 감소(159·149·…·19·8) → 15:24:35 `DONE`·Order `COMPLETED`(예정 완료 약 15:24:33, 차이 2초 이내). `261126-0003`(콜라, 조리 0초): 결제 1초 뒤 `COOKING` → 12초 뒤 `DONE`·`COMPLETED`(다음 스케줄러 주기에 완료) | dev 도메인 경유 OR-01·02·04 curl(customer-demo), 조리 시간은 CO-02 `cookSec` | 11/26 15:17~15:24 |
| K-02 | 혼잡도·예상 대기(CO-01·02)가 주문 수에 맞게 증가·감소, 고객 홈 표시와 일치 | PASS | CO-01 주문 전 대기 0·조리 0·0초 → 조리 중·대기 증가 → 완료 후 감소. 예상 대기 = 조리 중 남은 시간 + 대기 주문 조리 시간 합: 고객 홈 15:24:13 "약 3분 40초"(0004 남은 약 20초 + 0005 200초), 관리자 화면 15:24:29 "3분 24초"(약 4초 + 200초), CO-01 15:24:35 198초(0005 조리 시작 직후) — 세 값 모두 계산과 일치. 결제 직후 CO-01은 EV-01 도착 전이라 아직 0(OR-04 `PENDING`과 같은 시점) | CO-01·CO-02 curl, 브라우저 고객 홈·`#admin/cooking` | 11/26 15:12~15:24 |
| K-03 | 관리자 조리 현황(CO-03·04): 토큰 없음 401, 위조 `X-User-Role` 401, CUSTOMER 403, STORE_ADMIN 200, 대기열 FIFO(`queuedAt` 오름차순), 화면 `#admin/cooking`(#340) | PASS | overview·queue 각각 토큰 없음 401, 위조 `X-User-Role: STORE_ADMIN`(토큰 없음) 401, CUSTOMER 403 `FORBIDDEN`, STORE_ADMIN 200 `success:true`. 화면 `#admin/cooking` 정상 표시(Network 요청 모두 200). **FIFO 화면(11/27 11:56:44)**: 대기 2건이 대기 등록 시각 오름차순 — 1번 `261127-0015`(ID 49, 11:56:41), 2번 `261127-0016`(ID 50, 11:56:44), 조리 중 `0014`(ID 48)는 목록 제외(화면 안내와 같음). 영역별 조회 시각이 달라 "조회값 불일치" 배너가 뜨는 것은 화면 설계(서로 다른 시점 값을 섞지 않음). 오전 로그인 403(Gateway IP를 Origin으로 사용)은 dev 도메인 Origin으로 해소 | dev 도메인 경유 curl(`Origin`=dev 도메인, 토큰은 길이만 출력), 브라우저(admin-demo) 캡처 | 11/26 14:38~14:41, 11/27 11:56 |
| K-04 | 조리 전 취소(CI-03): 대기열 제거·조리 시작 안 함·대기 수 감소 / 조리 시작 후 취소 `409 COOKING_ALREADY_STARTED`, 조리 완료 후 EV-02 반영 전 `409 COOKING_ALREADY_DONE`, Order `COMPLETED` 후 `409 ORDER_NOT_CANCELABLE`, Cooking 접수 전 `409 COOKING_ORDER_PENDING`(API 명세 OR-05 오류 표). 거절 시 재고·환불 변화 없음 | PASS | **11/27 조리 완료 경계**(주문 `261127-0001`, orderId 27, 버거 180초): 조리 중 취소 `409 COOKING_ALREADY_STARTED`(09:38:21) → 완료 직전까지 `STARTED`(09:41:12.232) → Cooking 완료 후 Order 반영 전 **`409 COOKING_ALREADY_DONE`**(09:41:18.300) → EV-02 반영 후 **`409 ORDER_NOT_CANCELABLE`**(09:41:19.213), 최종 `COMPLETED`/`DONE`. 예정 완료 약 09:41:17, Cooking 완료→Order 반영 틈 약 0.9~1.3초. 모두 409 거절이라 주문·환불 변화 없음. CT-05(김민규 님 실행, #411)의 Cooking 쪽 교차 확인: 주문 17(`0007`) 15:28:27 대기열 등록 → 15:29:41 "조리 대기 주문을 취소했습니다", 조리 시작 로그 없음(Order `CANCELED` 시각과 일치). 같은 시각 조리 중이던 주문 16은 15:31:28 예정대로 완료. 주문 15(`0005`) 조리 시작 후 취소는 `409 COOKING_ALREADY_STARTED`, Cooking 취소 로그 없음 → 15:27:55 정상 완료. 결제 직후 취소 `409 COOKING_ORDER_PENDING`(Order 결과). `increase(cooking_tickets_canceled_total[3h])` ≈ 2. 취소 후 뒤 주문의 대기 수 감소는 CT-05에서 김민규 님 확인됨(11/26 17:49, 주문 23~26 어니언링 120초: 24 취소 200 후 25·26 순번 -1, 예상 대기 -123초 = 취소된 24의 조리 120초 + 두 조회 사이 경과 약 3초, 조리 중 23 영향 없음 — Cooking 계산식과 일치). 취소/조리 시작 동시 경합은 분담에 따라 CT-05에서 김민규 님 확인 | dev 도메인 OR-04·OR-05 curl(완료 직전부터 0.4초 간격 취소, 응답 코드가 바뀐 시각을 ms로 기록), Loki Cooking 로그(orderId 15·16·17), Prometheus 지표, CT-05 Order 응답(#411) | 11/27 09:38~09:41, 11/26 15:22~15:31 |
| K-05 | 여러 주문 FIFO(등록 순서대로 조리), 조리 중은 동시에 1건 이하 | PASS | **11/27 CT-06**: 어니언링(120초) 3건을 2초 간격 결제(48 11:56:37 → 49 11:56:39 → 50 11:56:42) → 48 `COOKING`·49 `WAITING` 앞 0·50 `WAITING` 앞 1 → 48 완료(약 11:58:3x) 직후 49 `COOKING`·50 앞 0 → 49 완료(약 12:00:38) 직후 50 `COOKING` → 50 완료(약 12:02:37). 조리 중 항상 1건, 완료 순서 = 결제 순서 = 대기 등록 순서, 다음 주문 예정 = 앞 주문 남은 시간 + 120초(112→232→352). 사전 관찰(11/26 15:22~15:24): `0005`(15:22:12 등록)가 `0004` 조리 중 대기 1번 → `0004` 완료 직후 조리 시작, 조리 중 항상 1건 이하. 대기 1건뿐이라 순서 비교는 대기 3건으로 다시 확인. 추가 관찰(15:28): 주문 16·17이 4ms 차이로 등록 → 먼저 등록된 16이 조리 시작, 17은 대기(`queuedAt` 순서 유지) | dev 도메인 OR-01·02·04 curl 20초 폴링(customer-demo, 시험 중 다른 주문 자제 공지), 관리자 FIFO 화면(K-03) | 11/27 11:56~12:03 |

## 2. RabbitMQ 이벤트 연동

| ID | 내용 | 상태 | 실제 결과 | 근거 | 일시 |
|---|---|---|---|---|---|
| M-01 | OrderConfirmed(EV-01, Order→Cooking)·CookingCompleted(EV-02, Cooking→Order) 전달, Outbox 전부 SENT | PASS | **11/27 CT-06**: 주문 48~55(8건) 모두 Order "결제 완료 주문 확정" 1 → Cooking "대기열에 등록" 1 → "조리를 완료" 1 → Order "조리 완료 반영" 1, **Cooking 완료·Order 반영 eventId 8건 모두 일치**. 이후 `order_outbox_pending`·`cooking_outbox_pending` 0(보낼 이벤트 없음 = 모두 SENT), DLQ 2개 0. 주문 39(11:07, 김민규 님 검증 주문)도 EV-01 약 1초·EV-02 약 1초. 사전 관찰(K-01): `0003`·`0004` | Loki 주문별 로그 집계(order-service·cooking-service, #425 상태 로그 반영 후), Prometheus Outbox·DLQ 지표 | 11/27 11:07~12:05 |
| M-02 | 같은 이벤트 재전달 시 전표 1개만(`cooking_order_confirmed_received_total{result="duplicate"}` 증가, 중복 전표 0). **취소된 주문의 OrderConfirmed가 재전달돼도 전표가 다시 생기지 않음**(CT-05 경계 조건) | PASS | 전표가 있는 주문에 OrderConfirmed를 Cooking 큐에 직접 발행(기본 교환기, 시험용 eventId `c7060000-…-0201/0202`). ① 주문 27(완료)·새 eventId → WARN "이미 조리 전표가 있는 주문입니다. 무시합니다"(`order_id` UNIQUE 겹) ② 같은 메시지 재발행 → INFO "이미 처리한 OrderConfirmed 이벤트를 무시합니다"(`processed_events` 겹) ③ 취소된 주문 17·새 eventId → WARN 같은 문구, 대기열 재진입 없음. `duplicate` 0→3, `created` 16 그대로, DLQ 0, 대기·조리 0. **Order 쪽 변화 없음**(김민규 님 DB 확인: 27 `COMPLETED`·17 `CANCELED`·상태 이력 그대로, 시험 시간대 `processed_events`·Outbox 새 행 0, Order 로그에 17·27 없음) | 발행 전 Loki로 두 주문의 전표 존재 확인 후 `rabbitmqadmin publish message`(Pod 안 환경 변수 계정), Cooking 로그·지표, Order DB·로그(김민규 님) | 11/27 11:23~11:24 |
| M-03 | 부하 중 결제 확정 주문 수 = 전표 수, 유실·중복 0 | PASS | 콜라(조리 0초) 5건을 2.3초 동안 연달아 주문·결제(51~55, 모두 200) → 25초 뒤 5건 모두 `COMPLETED`/`DONE`. 어니언링 3건 포함 8건 모두 Cooking "대기열에 등록" **정확히 1번**(유실 0·중복 0). 같은 시간 김민규 님 CT-07 주문이 섞여 전체 `created` 카운터 대신 주문별 로그로 판정 | Loki 주문별 로그 집계, OR-04 | 11/27 12:03~12:05 |
| M-04 | Cooking 여러 Pod(HPA)에서 중복 처리 0, 조리 중 1건 이하, 순서 기준(`queued_at`) 유지 — 거의 동시 결제는 결제 순서와 수십 ms 다를 수 있음(EV-01 문서) | NOT RUN | | | |
| M-05 | (선택) 처리 불가 이벤트 → DLQ 이동(`x-death` 기록), 다른 메시지 계속 처리 | PASS | **11/27 CT-08**: 필수 필드 `items`가 빠진 OrderConfirmed(시험 eventId `c7080000-…-0501`, orderId 999501)를 Cooking 큐에 직접 발행(17:42:44.282) → 0.15초 뒤 Cooking WARN "Retries exhausted"·"listener failed"로 거절(17:42:44.436), 전표 생성 없음 → `peakorder.dlx`를 거쳐 `cooking.order-confirmed.dlq` 1건, `x-death` reason `rejected`·queue `cooking.order-confirmed`·count 1. 본 큐 0·consumers 1 유지(다른 메시지 처리 계속). 런북대로 내용 확인(`ack_requeue_true`) 후 해당 1건만 제거(`ack_requeue_false`) → DLQ 0. 관찰: 거절 로그가 본문을 `byte[146]`으로만 출력해 eventId·orderId를 알 수 없음 → DLQ 원인 추적은 메시지를 직접 꺼내야 함(개선 후보) | `rabbitmqadmin publish/get message`(Pod 안 환경 변수 계정), `rabbitmqctl list_queues`, Loki Cooking 로그 | 11/27 17:42~17:47 |

## 3. 장애 복구 (Discord 사전 공유·시간대 지정, 클러스터 담당 입회)

| ID | 내용 | 상태 | 실제 결과 | 근거 | 일시 |
|---|---|---|---|---|---|
| F-01 | 조리 중 Cooking Pod 삭제 → 새 Pod가 이어받아 예정 시각 완료 | PASS | `261126-0008`(클래식 버거 180초): 16:11:50 `hkbsg`에서 조리 시작 → 16:13:08 Pod 삭제 → 26초 뒤 `7bp5p` Ready(재시작 0) → 교체 중 OR-04 `lookup UNAVAILABLE`·HTTP 200 약 20~30초 → 남은 시간이 이어서 감소(98 → 68, 처음부터 다시 시작하지 않음) → 16:14:50 `7bp5p`가 완료(시작 + 180초, 오차 0)·EV-02 발행, Order `COMPLETED` | OR-04 10초 폴링, `kubectl get pods -w`, Loki Cooking 로그(시작 `hkbsg` / 완료 `7bp5p`) | 11/26 16:11~16:15 |
| F-02 | Cooking 0개 → **탐지 전 확정된 주문의 이벤트는 큐에 보관** → 복구 후 순서대로 처리, 유실 0. **탐지 후 신규 주문·결제는 `503 COOKING_UNAVAILABLE`**(Order가 5초 주기 health 3회 연속 실패 시 차단, #56 — 약 15초) | PASS | **11/27 CT-08**: 준비 109(클래식 버거 180초) 조리 중·110(어니언링) 대기(17:47:23~25 결제). Cooking 0개(`scale --replicas=0`, 약 17:47:4x — 정확한 시각 미기록) → Order 차단(17:47:56.714) 전에 112·113(17:47:46~47)·114(17:47:53) 결제 `200 PAID`(OR-04 조리 상태 조회 불가 WARN) → 큐 `cooking.order-confirmed` messages 3·consumers 0, HPA REPLICAS 0(`cpu <unknown>`). 알림 7번 시험(O-02)을 거쳐 원래 이미지로 복원 → 17:49:54 기동 → 17:50:13 RabbitMQ 재연결 → **17:50:14 112→113→114 결제 순서대로 대기열 등록**(`queuedAt` 오름차순, 유실 0) → 109(예정 약 17:50:23)는 복구 직후 17:50:26 완료(조리 이어받기) → 110→112→114 순서로 조리(113은 취소, F-03). 2차 중단(17:53:32~17:56:11, 알림 7번 재시험)에서도 조리 중이던 112(예정 17:55:27)가 복구 직후 17:56:09 완료, 114 17:56:10 완료 → 109·112·114 `COMPLETED`/`DONE`. 사전 관찰(11/27 12:39~12:42, 김민규 님 실행): Order 차단은 Pod 종료 후 12초·해제는 Ready 후 4초(#411 O-01), Cooking은 preStop 10초 → graceful shutdown → 재기동 19.6초 → RabbitMQ 재연결, 오류 로그 0 | WSL `ct08.sh`(OR-01·02·04, 시각 ms), `rabbitmqctl list_queues`, `get hpa`, Loki Cooking·Order 로그, #411 O-01 | 11/27 17:47~17:57 (사전 12:39~12:42) |
| F-03 | Cooking 응답 없을 때 취소 → `503 COOKING_SERVICE_UNAVAILABLE`, 주문 그대로 → 복구 후 Order 스케줄러가 자동 처리 | PASS | **11/27 CT-08**: Cooking 0개 중 취소 — 113(큐에 있던 주문) 17:48:04, 110(장애 전부터 대기열에 있던 주문) 17:49:11 모두 `503 COOKING_SERVICE_UNAVAILABLE`. Order가 "결과를 모르는 취소 요청"으로 보관하고 30초마다 재확인(:16·:46초, 장애 중엔 `COOKING_SERVICE_UNAVAILABLE`). 복구 후 17:50:46 재확인에서 113은 대기 중이라 **취소 확정**(Cooking "조리 대기 주문을 취소" 17:50:46.253, 재고 복원·환불 paymentId 9080, OR-04 `CANCELED`), 110은 17:50:26에 이미 조리 시작 → `COOKING_ALREADY_STARTED`로 취소 불가 확정("결과를 모르던 취소 요청을 확정 count=1") → 17:52:27 `COMPLETED`·환불 없음. 두 주문 모두 섞인 상태 없음(정합성 유지). **관찰**: 장애 중 받은 취소는 재확인 주기(30초) 때문에 복구 직후 그 주문의 조리가 먼저 시작되면 취소되지 않음(이번엔 20초 차). 고객 응답은 503이라 취소 완료로 안내되지는 않음 → 결함 여부는 Order 담당(김민규 님)과 판단 | WSL OR-05·OR-04, Loki Order 로그(취소 재확인·확정), Loki Cooking 로그 | 11/27 17:48~17:52 |
| F-04 | RabbitMQ 재시작 → 그동안 Outbox 보관 → 복구 후 자동 발행, 유실 0 | PASS | **11/27 CT-08**: 115(어니언링 120초) 결제 18:01:38 → `COOKING`(18:01:41) → `scale statefulset rabbitmq --replicas=0`(18:01:43) → 18:01:57 Order 차단(Cooking health DOWN, #411 O-07과 같은 동작) → 115 조리 완료 뒤 CookingCompleted가 Cooking Outbox `PENDING`(`cooking_outbox_pending` 1, 18:04:37), 같은 eventId `d6e759cc…`로 1~2초마다 "이벤트 발행 실패, 다음 주기에 다시 시도" → 알림 5번 firing(18:09:41) → RabbitMQ 1개 → 18:10:49.877 Cooking 재연결 → **18:10:49.895 Order "조리 완료 반영 orderId=115" 같은 eventId**(유실 0) → 18:10:53 Order 차단 해제, Outbox 0·큐 4개 유지(durable)·consumers 1. Order 쪽 Outbox(OrderConfirmed)는 #411 O-07(11/27 14:22~14:28, 김민규 님) 참조. 시작 전 토큰 만료(15분)로 주문 401 상태에서 RabbitMQ를 먼저 내렸다가(17:58:25) 즉시 복구 후 재시작(영향 주문 없음). 관찰: 장애 중 발행 실패 WARN이 초당 1~2줄(약 6분에 수백 줄) → Loki 조회 한도(500줄)에 걸림, 같은 eventId 실패 로그 줄이기 검토(개선 후보) | WSL OR-01·02·04, `rabbitmqctl list_queues`, Prometheus `cooking_outbox_pending`·`ALERTS`, Loki Cooking·Order 로그, #411 O-07 | 11/27 17:58~18:12 |

## 4. 모니터링·로깅 (위 시나리오 진행 중 함께 확인)

| ID | 내용 | 상태 | 실제 결과 | 근거 | 일시 |
|---|---|---|---|---|---|
| O-01 | 수집 대상 6개 서비스 전부 up(`count by (service) (up{namespace="peakorder"} == 1)`), `PeakorderTargetDown` 없음. 업무 지표(`cooking_tickets`·Outbox·DLQ)가 시험 상황을 반영 | PASS | 사전: Auth·Inventory·Payment·Menu `/actuator/prometheus` 모두 200(547/187/125/1110줄). #401 ServiceMonitor 4개 선택 Sync `Succeeded`(16:00:19, OutOfSync는 4개뿐) → `up == 1` 6개 서비스 + `rabbitmq`, `up == 0` 0건, `PeakorderTargetDown` 0건 | Grafana sidecar에서 각 Service 호출, Prometheus API 조회 | 11/26 16:01 |
| O-02 | 알림 발화·해제: DLQ(M-05)→1번 `RabbitMQDeadLetterQueueNotEmpty`, RabbitMQ 재시작(F-04)→5번 Outbox, Cooking 가용 Pod 0(원하는 복제본 > 0)→7번 `PeakorderDeploymentNoAvailablePods`(Pod가 없으면 `up`이 사라져 2번은 안 울림 — 설계대로). 복구 후 inactive, 그 외 오탐 0 | PASS | **11/27 CT-08**: ① 1번 `RabbitMQDeadLetterQueueNotEmpty`(queue `cooking.order-confirmed.dlq`, warning): DLQ 1건(17:42:44) → firing 확인 17:44:39 → 메시지 제거 후 해제 확인 17:46:40. ② 7번 `PeakorderDeploymentNoAvailablePods`(deployment `cooking-service`, critical): 정진혁 님 허용·방법대로 `scale 0` → 없는 태그로 `set image` → `scale 1`(desired 1 / available 0, `ImagePullBackOff`). 1차(17:49:20)는 1분 유지 전에 복원해 pending까지(17:50:46), 2차(17:53:32) firing 확인(17:54:40 이후~17:55:45 이전) → 원래 태그 `sha-6219d6b…`로 복원(17:55:45 → 17:56:11 rolled out) → 해제 확인 17:57:25. ③ 5번 `CookingOutboxPending`(warning): Outbox 1(18:04:37 pending) → firing 18:09:41 → RabbitMQ 복구 후 해제 확인 18:12:00(Outbox 0). F-04 중 team02 알림은 5번뿐(RabbitMQ Pod가 없으면 `up`이 사라져 2번은 울리지 않음 — 설계대로). 그 외 오탐 0(차트 기본 `Watchdog`·`CPUThrottlingHigh`(node-exporter, info)만 관찰) | Prometheus `ALERTS` API(Grafana sidecar), `kubectl get deploy/pods` | 11/27 17:42~18:12 |
| O-03 | 주문 번호로 Order·Cooking 로그를 Loki에서 시간순 추적(`\| json`), 삭제된 Pod(F-01·F-02) 로그도 조회 | PASS | **11/27 재검증(#425 반영 후)**: 주문 39(`261127-0008`)를 한 번의 Loki 조회로 시간순 추적 — 11:07:31 Order "주문 생성" → Payment "결제 처리" → Order "결제 완료 주문 확정" → 11:07:32 Cooking 등록·시작 → 11:09:32 Cooking 완료 `eventId=ae4e1d60…` → 11:09:33 Order "조리 완료 반영" **같은 eventId**. CT-06 주문 48~55도 모두 같은 방식으로 추적(M-01). 11/26: Cooking 단계별 추적, F-01 삭제 Pod `hkbsg` 로그 61줄 보존, Order 로그 0줄 공백 발견(원본 34 = Loki 34로 수집 누락 아님) → #423·#425로 해결 | Loki query_range(`orderId`·`orderNo`·`eventId`), `kubectl logs` 원본과 줄 수 대조 | 11/26 16:05~16:16, 11/27 11:20 |
| O-04 | 시험 중 로그에 비밀번호·토큰·`Authorization` 0건 | PASS | CT-06 시험 시간대(11/27 약 11:15~12:05, 50분) `peakorder` 전체 로그에서 password·authorization·bearer·accesstoken·JWT 형태(`eyJ…`) 검색 **0건**(로그인 다수 포함 시간대) | Loki 대소문자 무시 정규식 검색(결과가 있으면 값을 가려 출력하도록 작성) | 11/27 12:05 |
| O-05 | 각 서비스 지표·ECS 로그 수집 상태(Auth D-05 포함) | PASS | **11/27**: `count by (application) (http_server_requests_seconds_count{namespace="peakorder"})`에 auth·cooking·**inventory**·menu·order·**payment** 6개 모두 표시 — Payment #397(태그 #427), Inventory #430(태그 #443, 11:53:54 롤링, 롤링 직후 옛 Pod 시계열 `(없음)`은 수 분 뒤 사라짐). Menu #407(HTTP probe) 반영 후 `up` 1·3시간 재시작 0. 11/26: 지표: O-01과 같음. ECS JSON 로그 설정: Auth·Cooking·Menu·Order(main 기준, 런북 #405), Inventory·Payment는 텍스트 로그. `application` 공통 지표 라벨 없음(16:02 확인): **Payment**(#397로 해결 예정)·**Inventory**(요청 지표 11·JVM 8 시계열 → #424) → `application` 기준 패널(요청 수·5xx 등)에서 빠짐. #397 병합 후 `count by (application) (http_server_requests_seconds_count{namespace="peakorder"})` 재확인. Menu ECS dev 반영 확인: 24h WARN 4줄이 `\| json`으로 파싱(SpringDoc 기동 안내 — 정상 경고), #389 | Prometheus API(Grafana sidecar), `kubectl rollout status`, `deploy/apps/*/base/deployment.yaml` `LOGGING_STRUCTURED_FORMAT_CONSOLE=ecs` | 11/26, 11/27 11:20~11:55 |

## 5. 공동 테스트

CT 매핑은 개인 계획(Discord) 기준 **제안**이며, 팀 확정 후 갱신한다.

| CT | 역할 | 연결 항목 | 상태 | 비고 |
|---|---|---|---|---|
| CT-06 이벤트 중복·지연·FIFO·조리 상태 | **주관** | K-01·K-05·M-01~03 | **PASS** | 11/27 11:20~12:05 진행(Discord 공지). K-01·K-05·M-01·M-02·M-03 PASS, Order 쪽 값은 김민규 님 확인(M-02). 이벤트 중복 검증을 CT-06과 연계하라는 팀장님 결정(11/26 3번) 반영. M-04는 CT-07, M-05는 CT-08에서 |
| CT-08 장애 복구·로그·메트릭·알림 | **주관** | F-01~04·O-01~05 | IN PROGRESS | 장애 주입은 사전 공유·종료 후 복원. F-01·O-01(11/26), O-03·O-04·O-05(11/27) PASS. 남음 F-02~04·M-05·O-02(11/30 오전). **Cooking 장애·복구 시험은 이 CT-08로 통합**(팀장님 결정 11/26 3번) — 김민규 님 Order O-01(Cooking 장애 시 주문 차단·해제 시각)도 F-02에서 함께 기록. 참고: Menu는 DB 장애 시 readiness가 UP이라 5xx 알림(미구현) 외 감지 수단 없음(#407 리뷰) |
| CT-02 인증·격리 | 참여 | K-03 | PASS | 이태훈 님 주관. Cooking 관리자 API의 401·403·200(11/26)·관리자 FIFO 화면(11/27) 확인 |
| CT-05 취소·재고 복원·환불 | 참여 | K-04·F-03 | IN PROGRESS | 김민규 님 주관(#411). 정상 취소·조리 시작 후 거절·접수 전 거절의 Cooking 쪽 값 확인 완료(11/26 16:50, Discord 답글). 장애 주입 시나리오(환불·복원 실패, 동시 취소)는 남음. 경계 조건 분담(11/26 Discord): 대기 수 감소·취소/조리 시작 동시 경합은 김민규 님, 조리 완료 직후 취소(K-04)·Cooking 없을 때 취소(F-03)·취소 주문 이벤트 재전달(M-02)은 김지윤 |
| CT-07 다중 Pod·HPA | 참여 | M-04 | NOT RUN | 김민규 님 주관 |
| J-01 로그인 → 메뉴 → 주문 → 결제 → 조리 완료 | 참여 | K-01·M-01 | NOT RUN | CT-01 E2E와 함께 |
| J-02 취소 → 재고 복원 → 환불 | 참여 | K-04 | NOT RUN | 실제 서비스끼리 연동 확인이 아직 없음 → CT-05와 함께 |

## 6. 최종 회귀

| ID | 내용 | 상태 | 실제 결과 | 근거 | 일시 |
|---|---|---|---|---|---|
| R-01 | 결함 수정·재배포 후 K-01·K-04·M-01·O-02 재검증 | NOT RUN | | | |

## 7. 일정

| 날짜 | 항목 |
|---|---|
| 11/26 | Draft PR, 배포·수집 상태(O-01·O-05), 관리자 권한(K-03) |
| 11/27 | 정상 흐름(K-01·K-02·K-05·M-01), 취소(K-04), 중복·부하·다중 Pod(M-02~04), 로그 추적(O-03·O-04) |
| 11/27 17:40~18:12 | **CT-08 앞당겨 완료**: 장애 복구(F-02~04)·DLQ(M-05)·알림(O-02) — 정진혁 님 입회 생략·알림 7번 허용(Discord) |
| 11/30 | 다중 Pod(M-04, CT-07), 공동 검증(J-01·J-02), 결함 수정·재배포 |
| 12/1 오전 | 최종 회귀(R-01), 결과 정리 |

## 완료 기준

- Cooking 정상·취소·권한 시나리오 통과, 실패 응답 코드가 API 명세와 일치
- 이벤트 유실·중복 0, Order ↔ Cooking 상태 전수 일치
- 장애 복구 후 자동 정상화, 해당 알림 발화·해제 확인, 그 외 오탐 0
- 모든 시나리오를 Loki에서 주문 번호로 추적 가능
- 종료 시 DLQ 0·Outbox 미발행 0·Cooking `Synced Healthy`
- 발견한 결함은 모두 Issue 등록 → Fix PR → dev 재배포 → 같은 시나리오로 재검증(RETEST), 결과는 이 문서에 반영

## 8. 기타 확인 기록

통합 테스트 기간 전에 확인한 내용이다. 같은 dev 버전에서 다시 확인해야 결과로 기록한다.

- 11/25 #349: Gateway 경유 Cooking 관리자 API — 토큰 없음·위조 헤더 401, 공개 범위 밖 경로 404, CO-01·02 200 (K-03 일부)
- 11/25 #313(김민규 님): Cooking 2 Pod에서 전표 중복 없음, 조리 중 1건 이하, 조리 중 Pod 삭제해도 예정 시각에 완료, Outbox 전부 SENT (K-05·M-04·F-01 사전 확인)
- 11/25 #347: 교체 전 Pod 로그가 Loki에 남음 (O-03 사전 확인)
- 11/25 #346: 알림 규칙 `service-health` 3개 inactive로 적용
- 11/26 dev 로그인 403은 Auth `allowed-origins`에 dev 도메인이 없어서였고 Auth 담당이 해결함(#404 기록) → 11/26 14:38 K-03 재시도로 해소 확인
- 11/26 관리자 화면 관찰(다른 담당자의 주문, 결과로 기록하지 않음): 14:41:23 조리 중 1건(`261126-0001`)·예상 대기 1분 20초 → 14:42:45 조리 중 0·오늘 완료 1·오늘 취소 1·예상 대기 0초. 예정 시각 자동 완료 동작과 일치. 취소 1건이 어느 주문인지는 Order 담당에게 확인 필요
- 11/26 공용 계정 주의: `261126-0005`는 같은 `customer-demo` 계정으로 다른 담당자가 주문한 것(고객 홈 "최근 주문"에 표시). K-05·CT-06처럼 주문을 대조하는 시험은 주문 번호를 따로 기록하거나 시험 시간에 그 계정 주문을 피하도록 공지 필요
- 11/26 F-01: 삭제된 옛 Pod는 `Terminating` 후 `Error`로 표시됨 — SIGTERM 시 JVM 종료 코드(#190에서도 기록), 동작 영향 없음. 시험 전 cp available 1059Mi(Sync 전 1132Mi, VS Code 원격 종료 요청 후)
- 11/26 Cooking 취소 로그(`조리 대기 주문을 취소했습니다 orderId=17`)에는 `orderNo`가 없음 — 등록·시작·완료 로그와 달라 observability 3-2(주문 추적 키 `orderId`·`orderNo`)에 맞추려면 보완 필요(개선 후보)
- 11/26 Cooking Pod 교체(F-01) 후 `cooking_tickets_canceled_total`이 0으로 초기화됨 — 하루 취소 수는 `_total` 값이 아니라 `increase()`로 봐야 함(대시보드 참고)
- 11/27 Cooking 중복 무시 로그 레벨: 같은 주문 중복은 WARN, 같은 eventId 재전달은 INFO(M-02). eventId 재전달은 at-least-once 전달에서 정상적으로 생기는 일이라 INFO도 합리적이나, observability 3-3은 "중복 이벤트 무시"를 WARN 예시로 듦 → 기준 통일 여부 검토 후보(Cooking)
- 11/27 배포 원칙(팀장님 결정 11/26 4번): 한 서비스씩 롤링하고 검증 후 다음 서비스로 → #430(Inventory) 태그 병합을 Order 롤링(#425) 검증 뒤로, CT-07(김민규 님, 11:38 시작)과 겹치지 않게 진행. 자동 태그 PR은 이후 main 병합이 있으면 새 PR로 대체됨(#442 → #443)
- 11/27 CT-06과 CT-07이 11:38~ 시간대가 겹침 → 주문 없는 확인(O-03·M-02)은 먼저, 주문 시험은 CT-07 종료 후. 공동 시험은 시작 전 다른 CT 진행 여부를 확인할 것
- 11/26 결제 직후 1초 정도는 CO-01·OR-04에 아직 반영되지 않음(EV-01 도착 전, OR-04 `lookup PENDING`) — 설계대로
- 11/27 CT-08 진행 조건: Discord 공지(17:40~19:40) 후 단독 진행, 정진혁 님 입회 생략·알림 7번(기동 실패 주입) 허용. cp available 시작 1088Mi·진행 중 최저 945Mi(중단 기준 300Mi), 노드 3개 Ready 유지. 종료 시 Cooking 이미지 원래 태그(`sha-6219d6b…`) 복원·Pod 1/1, RabbitMQ 1/1, DLQ 0·Outbox 0. 시험 주문 109~115(customer-demo), 111은 결제하지 않은 `CREATED`(확보 TTL로 재고 해제)
- 11/27 RabbitMQ 중단 시 Order 신규 주문 차단의 원인: Order는 Cooking `/actuator/health`(전체)를 보고, Spring Boot가 RabbitMQ 상태를 전체 health에 자동 포함 → 브로커 장애만으로 Cooking DOWN 판정(readiness는 미포함이라 Pod는 Ready). Outbox 설계 의도보다 범위가 넓음 → 발표 후 개선 후보(서비스 간 계약이라 팀 합의 필요, #411 리뷰)
- 11/27 Access 토큰 수명 15분 — 장시간 시험 중 401이면 재로그인(F-04 시작 시 발생)

## 관련 이슈·PR

- 이 문서: #408
- 11/27 반영: #425(Order 상태 로그, 태그 #439), #430(Inventory 라벨, 태그 #443), #407(Menu probe), #438(Cooking prod overlay — prod 준비)
- 수집·알림: #401(ServiceMonitor 4개), #397(Payment 공통 지표 라벨, 정진혁 님), #346(서비스 상태 알림), #289·#309(Outbox·취소 후속 알림), #237(DLQ 알림)
- 로깅: #330(Loki·Alloy 설치), #359(README·런북 Loki 조회), #405(런북 ECS 서비스 목록)
- Cooking: #349(관리자 API dev 공개), #313·#332(다중 Pod·HPA), #370(dev 이미지)
- 선행 조건: #399(주문 접수 초기값)
- 통합 테스트 중 등록한 결함·개선: #424 → PR #430(Inventory 지표 `application` 라벨, O-05), #423·#425(Order 주문 처리 INFO 로그, O-03 — 같은 내용으로 만든 #426은 중복으로 닫음)
