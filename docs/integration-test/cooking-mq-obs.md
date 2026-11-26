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
| 주문 접수 켜짐 | 충족 | 11/26 14:19 Order 담당이 OR-07로 `isOpen=true`·`acceptingOrders=true` 설정(#399 병합 후, 통합 테스트 기간 유지·종료 후 복원 — Discord 공지). 초기값은 둘 다 false라 주문이 409 `STORE_NOT_ACCEPTING_ORDERS` |
| 전 서비스 dev 최신 이미지·`Synced Healthy` | 확인 필요 | 시험 시작 시 기록 |
| 시작 상태: 업무 큐 consumers ≥ 1, DLQ 0, Outbox 미발행 0 | 확인 필요 | 시험 시작 시 기록 |
| ServiceMonitor 6개 서비스 | 충족 | 11/26 16:00 #401 Sync (O-01) |
| 장애 주입 전 cp available 1Gi 이상 | — | 300Mi 미만이면 중단. Discord 사전 공유·시간 조율, 종료 후 복원 |

## 1. Cooking Service

| ID | 내용 | 상태 | 실제 결과 | 근거 | 일시 |
|---|---|---|---|---|---|
| K-01 | 주문 확정 → 조리 전표 등록(대기) → 조리 중 → 예정 시각 완료. 주문 상세(OR-04)의 `cooking`(CI-02)이 단계별로 일치 | PASS | `261126-0004`(클래식 버거, 조리 180초): 결제 `PAID` 15:21:31 → `lookup PENDING`(EV-01 도착 전) → 15:21:42 `COOKING` 남은 시간 170초 → 10~12초 간격 조회마다 같은 만큼 감소(159·149·…·19·8) → 15:24:35 `DONE`·Order `COMPLETED`(예정 완료 약 15:24:33, 차이 2초 이내). `261126-0003`(콜라, 조리 0초): 결제 1초 뒤 `COOKING` → 12초 뒤 `DONE`·`COMPLETED`(다음 스케줄러 주기에 완료) | dev 도메인 경유 OR-01·02·04 curl(customer-demo), 조리 시간은 CO-02 `cookSec` | 11/26 15:17~15:24 |
| K-02 | 혼잡도·예상 대기(CO-01·02)가 주문 수에 맞게 증가·감소, 고객 홈 표시와 일치 | PASS | CO-01 주문 전 대기 0·조리 0·0초 → 조리 중·대기 증가 → 완료 후 감소. 예상 대기 = 조리 중 남은 시간 + 대기 주문 조리 시간 합: 고객 홈 15:24:13 "약 3분 40초"(0004 남은 약 20초 + 0005 200초), 관리자 화면 15:24:29 "3분 24초"(약 4초 + 200초), CO-01 15:24:35 198초(0005 조리 시작 직후) — 세 값 모두 계산과 일치. 결제 직후 CO-01은 EV-01 도착 전이라 아직 0(OR-04 `PENDING`과 같은 시점) | CO-01·CO-02 curl, 브라우저 고객 홈·`#admin/cooking` | 11/26 15:12~15:24 |
| K-03 | 관리자 조리 현황(CO-03·04): 토큰 없음 401, 위조 `X-User-Role` 401, CUSTOMER 403, STORE_ADMIN 200, 대기열 FIFO(`queuedAt` 오름차순), 화면 `#admin/cooking`(#340) | IN PROGRESS | overview·queue 각각 토큰 없음 401, 위조 `X-User-Role: STORE_ADMIN`(토큰 없음) 401, CUSTOMER 403 `FORBIDDEN`, STORE_ADMIN 200 `success:true`. 화면 `#admin/cooking` 정상 표시(Network 요청 모두 200). **남음**: 대기열 FIFO 순서(대기 2건 이상 필요 → K-05와 함께). 오전 로그인 403(Gateway IP를 Origin으로 사용)은 dev 도메인 Origin으로 해소 | dev 도메인 경유 curl(`Origin`=dev 도메인, 토큰은 길이만 출력), 브라우저(admin-demo) | 11/26 14:38~14:41 |
| K-04 | 조리 전 취소(CI-03): 대기열 제거·조리 시작 안 함·대기 수 감소 / 조리 시작 후 취소 `409 COOKING_ALREADY_STARTED`, 조리 완료 후 EV-02 반영 전 `409 COOKING_ALREADY_DONE`, Order `COMPLETED` 후 `409 ORDER_NOT_CANCELABLE`, Cooking 접수 전 `409 COOKING_ORDER_PENDING`(API 명세 OR-05 오류 표). 거절 시 재고·환불 변화 없음 | IN PROGRESS | CT-05(김민규 님 실행, #411)의 Cooking 쪽 교차 확인: 주문 17(`0007`) 15:28:27 대기열 등록 → 15:29:41 "조리 대기 주문을 취소했습니다", 조리 시작 로그 없음(Order `CANCELED` 시각과 일치). 같은 시각 조리 중이던 주문 16은 15:31:28 예정대로 완료. 주문 15(`0005`) 조리 시작 후 취소는 `409 COOKING_ALREADY_STARTED`, Cooking 취소 로그 없음 → 15:27:55 정상 완료. 결제 직후 취소 `409 COOKING_ORDER_PENDING`(Order 결과). `increase(cooking_tickets_canceled_total[3h])` ≈ 2. **남음**: 조리 완료 직후 취소(EV-02 반영 전 `COOKING_ALREADY_DONE` / 반영 후 `ORDER_NOT_CANCELABLE` 경계 — 180초 메뉴로 `expectedReadySec` 0 직후와 `COMPLETED` 후 각각 취소). 취소 후 뒤 주문의 대기 수 감소·취소/조리 시작 동시 경합은 CT-05에서 김민규 님 확인 | Loki Cooking 로그(orderId 15·16·17), Prometheus 지표, CT-05 Order 응답(#411) | 11/26 15:22~15:31 (확인 16:50) |
| K-05 | 여러 주문 FIFO(등록 순서대로 조리), 조리 중은 동시에 1건 이하 | NOT RUN | 사전 관찰(11/26 15:22~15:24): `0005`(15:22:12 등록)가 `0004` 조리 중 대기 1번 → `0004` 완료 직후 조리 시작, 조리 중 항상 1건 이하. 대기 1건뿐이라 순서 비교는 대기 3건으로 다시 확인. 추가 관찰(15:28): 주문 16·17이 4ms 차이로 등록 → 먼저 등록된 16이 조리 시작, 17은 대기(`queuedAt` 순서 유지) | | |

## 2. RabbitMQ 이벤트 연동

| ID | 내용 | 상태 | 실제 결과 | 근거 | 일시 |
|---|---|---|---|---|---|
| M-01 | OrderConfirmed(EV-01, Order→Cooking)·CookingCompleted(EV-02, Cooking→Order) 전달, Outbox 전부 SENT | NOT RUN | 사전 관찰(K-01): EV-01 결제 후 약 1초 안에 Cooking 등록, EV-02 완료 후 Order `COMPLETED` 반영(`0003`·`0004`). Outbox SENT·큐 수치는 CT-06에서 Order 담당과 대조 | | |
| M-02 | 같은 이벤트 재전달 시 전표 1개만(`cooking_order_confirmed_received_total{result="duplicate"}` 증가, 중복 전표 0). **취소된 주문의 OrderConfirmed가 재전달돼도 전표가 다시 생기지 않음**(CT-05 경계 조건) | NOT RUN | | | |
| M-03 | 부하 중 결제 확정 주문 수 = 전표 수, 유실·중복 0 | NOT RUN | | | |
| M-04 | Cooking 여러 Pod(HPA)에서 중복 처리 0, 조리 중 1건 이하, 순서 기준(`queued_at`) 유지 — 거의 동시 결제는 결제 순서와 수십 ms 다를 수 있음(EV-01 문서) | NOT RUN | | | |
| M-05 | (선택) 처리 불가 이벤트 → DLQ 이동(`x-death` 기록), 다른 메시지 계속 처리 | NOT RUN | | | |

## 3. 장애 복구 (Discord 사전 공유·시간대 지정, 클러스터 담당 입회)

| ID | 내용 | 상태 | 실제 결과 | 근거 | 일시 |
|---|---|---|---|---|---|
| F-01 | 조리 중 Cooking Pod 삭제 → 새 Pod가 이어받아 예정 시각 완료 | PASS | `261126-0008`(클래식 버거 180초): 16:11:50 `hkbsg`에서 조리 시작 → 16:13:08 Pod 삭제 → 26초 뒤 `7bp5p` Ready(재시작 0) → 교체 중 OR-04 `lookup UNAVAILABLE`·HTTP 200 약 20~30초 → 남은 시간이 이어서 감소(98 → 68, 처음부터 다시 시작하지 않음) → 16:14:50 `7bp5p`가 완료(시작 + 180초, 오차 0)·EV-02 발행, Order `COMPLETED` | OR-04 10초 폴링, `kubectl get pods -w`, Loki Cooking 로그(시작 `hkbsg` / 완료 `7bp5p`) | 11/26 16:11~16:15 |
| F-02 | Cooking 0개 → 주문 이벤트는 큐에 보관 → 복구 후 순서대로 처리, 유실 0 | NOT RUN | | | |
| F-03 | Cooking 응답 없을 때 취소 → `503 COOKING_SERVICE_UNAVAILABLE`, 주문 그대로 → 복구 후 Order 스케줄러가 자동 처리 | NOT RUN | | | |
| F-04 | RabbitMQ 재시작 → 그동안 Outbox 보관 → 복구 후 자동 발행, 유실 0 | NOT RUN | | | |

## 4. 모니터링·로깅 (위 시나리오 진행 중 함께 확인)

| ID | 내용 | 상태 | 실제 결과 | 근거 | 일시 |
|---|---|---|---|---|---|
| O-01 | 수집 대상 6개 서비스 전부 up(`count by (service) (up{namespace="peakorder"} == 1)`), `PeakorderTargetDown` 없음. 업무 지표(`cooking_tickets`·Outbox·DLQ)가 시험 상황을 반영 | PASS | 사전: Auth·Inventory·Payment·Menu `/actuator/prometheus` 모두 200(547/187/125/1110줄). #401 ServiceMonitor 4개 선택 Sync `Succeeded`(16:00:19, OutOfSync는 4개뿐) → `up == 1` 6개 서비스 + `rabbitmq`, `up == 0` 0건, `PeakorderTargetDown` 0건 | Grafana sidecar에서 각 Service 호출, Prometheus API 조회 | 11/26 16:01 |
| O-02 | 알림 발화·해제: DLQ(M-05)→1번 `RabbitMQDeadLetterQueueNotEmpty`, RabbitMQ 재시작(F-04)→5번 Outbox, Cooking 0개(F-02)→7번 `PeakorderDeploymentNoAvailablePods`(Pod가 없으면 `up`이 사라져 2번은 안 울림 — 설계대로). 복구 후 inactive, 그 외 오탐 0 | NOT RUN | | | |
| O-03 | 주문 번호로 Order·Cooking 로그를 Loki에서 시간순 추적(`\| json`), 삭제된 Pod(F-01·F-02) 로그도 조회 | IN PROGRESS | Cooking: `0004`·`0008`을 orderId·orderNo로 등록·시작·완료 단계별 추적 가능. F-01에서 삭제된 Pod `hkbsg` 로그 61줄 보존. Payment: `orderId=14` 결제 로그 추적 가능(텍스트). **Order: 주문 처리 중 로그 0줄** — 현재 Pod 원본 34줄 = Loki 34줄로 수집 누락은 없음, 최근 1시간(주문 2건 처리) 원본 0줄 → 관측 공백 → Order 담당 #423·PR #425에서 상태 변경 INFO 로그 추가 중(병합·dev 반영 후 재검증) | Loki query_range(`orderId`·`orderNo`), `kubectl logs` 원본과 줄 수 대조 | 11/26 16:05~16:16 |
| O-04 | 시험 중 로그에 비밀번호·토큰·`Authorization` 0건 | NOT RUN | | | |
| O-05 | 각 서비스 지표·ECS 로그 수집 상태(Auth D-05 포함) | IN PROGRESS | 지표: O-01과 같음. ECS JSON 로그 설정: Auth·Cooking·Menu·Order(main 기준, 런북 #405), Inventory·Payment는 텍스트 로그. `application` 공통 지표 라벨 없음(16:02 확인): **Payment**(#397로 해결 예정)·**Inventory**(요청 지표 11·JVM 8 시계열 → #424) → `application` 기준 패널(요청 수·5xx 등)에서 빠짐. #397 병합 후 `count by (application) (http_server_requests_seconds_count{namespace="peakorder"})` 재확인. Menu ECS dev 반영 확인: 24h WARN 4줄이 `\| json`으로 파싱(SpringDoc 기동 안내 — 정상 경고), #389 | `deploy/apps/*/base/deployment.yaml` `LOGGING_STRUCTURED_FORMAT_CONSOLE=ecs` | 11/26 |

## 5. 공동 테스트

CT 매핑은 개인 계획(Discord) 기준 **제안**이며, 팀 확정 후 갱신한다.

| CT | 역할 | 연결 항목 | 상태 | 비고 |
|---|---|---|---|---|
| CT-06 이벤트 중복·지연·FIFO·조리 상태 | **주관** | K-01·K-05·M-01~05 | NOT RUN | 같은 주문 ID로 Order 담당과 함께 검증. 실행 조건·시간은 Discord에서 조율(11/27~11/30) |
| CT-08 장애 복구·로그·메트릭·알림 | **주관** | F-01~04·O-01~05 | IN PROGRESS | 장애 주입은 사전 공유·클러스터 담당 입회, 종료 후 복원. F-01·O-01 PASS(11/26). 참고: Menu는 DB 장애 시 readiness가 UP이라 5xx 알림(미구현) 외 감지 수단 없음(#407 리뷰) |
| CT-02 인증·격리 | 참여 | K-03 | IN PROGRESS | 이태훈 님 주관. Cooking 관리자 API의 401·403·200 확인(11/26) |
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
| 11/30 | 장애 복구(F-01~04)와 알림(O-02), 공동 검증(CT-06·CT-08, J-01·J-02), 결함 수정·재배포 |
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
- 11/26 결제 직후 1초 정도는 CO-01·OR-04에 아직 반영되지 않음(EV-01 도착 전, OR-04 `lookup PENDING`) — 설계대로

## 관련 이슈·PR

- 이 문서: #408
- 수집·알림: #401(ServiceMonitor 4개), #397(Payment 공통 지표 라벨, 정진혁 님), #346(서비스 상태 알림), #289·#309(Outbox·취소 후속 알림), #237(DLQ 알림)
- 로깅: #330(Loki·Alloy 설치), #359(README·런북 Loki 조회), #405(런북 ECS 서비스 목록)
- Cooking: #349(관리자 API dev 공개), #313·#332(다중 Pod·HPA), #370(dev 이미지)
- 선행 조건: #399(주문 접수 초기값)
- 통합 테스트 중 등록한 결함·개선: #424(Inventory 지표 `application` 라벨, O-05), #423·#425(Order 주문 처리 INFO 로그, O-03 — 같은 내용으로 만든 #426은 중복으로 닫음)
