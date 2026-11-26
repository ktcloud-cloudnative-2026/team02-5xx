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
| 로깅 | Loki 21.3.1·Alloy 1.15.0 (`logging-dev`), 보관 3일(하루 로그량 실측 후 확정)·PVC 5Gi |
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
| ServiceMonitor 6개 서비스 | 진행 중 | #401 Sync 후 (O-01) |
| 장애 주입 전 cp available 1Gi 이상 | — | 300Mi 미만이면 중단. Discord 사전 공유·시간 조율, 종료 후 복원 |

## 1. Cooking Service

| ID | 내용 | 상태 | 실제 결과 | 근거 | 일시 |
|---|---|---|---|---|---|
| K-01 | 주문 확정 → 조리 전표 등록(대기) → 조리 중 → 예정 시각 완료. 주문 상세(OR-04)의 `cooking`(CI-02)이 단계별로 일치 | NOT RUN | | | |
| K-02 | 혼잡도·예상 대기(CO-01·02)가 주문 수에 맞게 증가·감소, 고객 홈 표시와 일치 | NOT RUN | | | |
| K-03 | 관리자 조리 현황(CO-03·04): 토큰 없음 401, 위조 `X-User-Role` 401, CUSTOMER 403, STORE_ADMIN 200, 대기열 FIFO(`queuedAt` 오름차순), 화면 `#admin/cooking`(#340) | IN PROGRESS | overview·queue 각각 토큰 없음 401, 위조 `X-User-Role: STORE_ADMIN`(토큰 없음) 401, CUSTOMER 403 `FORBIDDEN`, STORE_ADMIN 200 `success:true`. 화면 `#admin/cooking` 정상 표시(Network 요청 모두 200). **남음**: 대기열 FIFO 순서(대기 2건 이상 필요 → K-05와 함께). 오전 로그인 403(Gateway IP를 Origin으로 사용)은 dev 도메인 Origin으로 해소 | dev 도메인 경유 curl(`Origin`=dev 도메인, 토큰은 길이만 출력), 브라우저(admin-demo) | 11/26 14:38~14:41 |
| K-04 | 조리 전 취소(CI-03): 대기열 제거·조리 시작 안 함·대기 수 감소 / 조리 시작 후·완료 후 취소: `409 ORDER_NOT_CANCELABLE`, 재고·환불 변화 없음 | NOT RUN | | | |
| K-05 | 여러 주문 FIFO(등록 순서대로 조리), 조리 중은 동시에 1건 이하 | NOT RUN | | | |

## 2. RabbitMQ 이벤트 연동

| ID | 내용 | 상태 | 실제 결과 | 근거 | 일시 |
|---|---|---|---|---|---|
| M-01 | OrderConfirmed(EV-01, Order→Cooking)·CookingCompleted(EV-02, Cooking→Order) 전달, Outbox 전부 SENT | NOT RUN | | | |
| M-02 | 같은 이벤트 재전달 시 전표 1개만(`cooking_order_confirmed_received_total{result="duplicate"}` 증가, 중복 전표 0) | NOT RUN | | | |
| M-03 | 부하 중 결제 확정 주문 수 = 전표 수, 유실·중복 0 | NOT RUN | | | |
| M-04 | Cooking 여러 Pod(HPA)에서 중복 처리 0, 조리 중 1건 이하, 순서 기준(`queued_at`) 유지 — 거의 동시 결제는 결제 순서와 수십 ms 다를 수 있음(EV-01 문서) | NOT RUN | | | |
| M-05 | (선택) 처리 불가 이벤트 → DLQ 이동(`x-death` 기록), 다른 메시지 계속 처리 | NOT RUN | | | |

## 3. 장애 복구 (Discord 사전 공유·시간대 지정, 클러스터 담당 입회)

| ID | 내용 | 상태 | 실제 결과 | 근거 | 일시 |
|---|---|---|---|---|---|
| F-01 | 조리 중 Cooking Pod 삭제 → 새 Pod가 이어받아 예정 시각 완료 | NOT RUN | | | |
| F-02 | Cooking 0개 → 주문 이벤트는 큐에 보관 → 복구 후 순서대로 처리, 유실 0 | NOT RUN | | | |
| F-03 | Cooking 응답 없을 때 취소 → `503 COOKING_SERVICE_UNAVAILABLE`, 주문 그대로 → 복구 후 Order 스케줄러가 자동 처리 | NOT RUN | | | |
| F-04 | RabbitMQ 재시작 → 그동안 Outbox 보관 → 복구 후 자동 발행, 유실 0 | NOT RUN | | | |

## 4. 모니터링·로깅 (위 시나리오 진행 중 함께 확인)

| ID | 내용 | 상태 | 실제 결과 | 근거 | 일시 |
|---|---|---|---|---|---|
| O-01 | 수집 대상 6개 서비스 전부 up(`count by (service) (up{namespace="peakorder"} == 1)`), `PeakorderTargetDown` 없음. 업무 지표(`cooking_tickets`·Outbox·DLQ)가 시험 상황을 반영 | IN PROGRESS | Cooking·Order는 수집 중(11/25). Auth·Inventory·Payment·Menu `/actuator/prometheus` 모두 200(547/187/125/1110줄) → ServiceMonitor 추가 PR #401 승인, dev Sync 대기 | `monitoring` namespace(Grafana sidecar)에서 각 Service 호출 — Prometheus 수집과 같은 경로·NetworkPolicy 조건 | 11/26 |
| O-02 | 알림 발화·해제: DLQ(M-05)→1번 `RabbitMQDeadLetterQueueNotEmpty`, RabbitMQ 재시작(F-04)→5번 Outbox, Cooking 0개(F-02)→7번 `PeakorderDeploymentNoAvailablePods`(Pod가 없으면 `up`이 사라져 2번은 안 울림 — 설계대로). 복구 후 inactive, 그 외 오탐 0 | NOT RUN | | | |
| O-03 | 주문 번호로 Order·Cooking 로그를 Loki에서 시간순 추적(`| json`), 삭제된 Pod(F-01·F-02) 로그도 조회 | NOT RUN | | | |
| O-04 | 시험 중 로그에 비밀번호·토큰·`Authorization` 0건 | NOT RUN | | | |
| O-05 | 각 서비스 지표·ECS 로그 수집 상태(Auth D-05 포함) | IN PROGRESS | 지표: O-01과 같음. ECS JSON 로그 설정: Auth·Cooking·Menu·Order(main 기준, 런북 #405), Inventory·Payment는 텍스트 로그 | `deploy/apps/*/base/deployment.yaml` `LOGGING_STRUCTURED_FORMAT_CONSOLE=ecs` | 11/26 |

## 5. 공동 테스트

CT 매핑은 개인 계획(Discord) 기준 **제안**이며, 팀 확정 후 갱신한다.

| CT | 역할 | 연결 항목 | 상태 | 비고 |
|---|---|---|---|---|
| CT-06 이벤트 중복·지연·FIFO·조리 상태 | **주관** | K-01·K-05·M-01~05 | NOT RUN | 같은 주문 ID로 Order 담당과 함께 검증. 실행 조건·시간은 Discord에서 조율(11/27~11/30) |
| CT-08 장애 복구·로그·메트릭·알림 | **주관** | F-01~04·O-01~05 | NOT RUN | 장애 주입은 사전 공유·클러스터 담당 입회, 종료 후 복원 |
| CT-02 인증·격리 | 참여 | K-03 | IN PROGRESS | 이태훈 님 주관. Cooking 관리자 API의 401·403·200 확인(11/26) |
| CT-05 취소·재고 복원·환불 | 참여 | K-04·F-03 | NOT RUN | 김민규 님 주관 |
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

## 관련 이슈·PR

- 이 문서: #408
- 수집·알림: #401(ServiceMonitor 4개), #346(서비스 상태 알림), #289·#309(Outbox·취소 후속 알림), #237(DLQ 알림)
- 로깅: #330(Loki·Alloy 설치), #359(README·런북 Loki 조회), #405(런북 ECS 서비스 목록)
- Cooking: #349(관리자 API dev 공개), #313·#332(다중 Pod·HPA), #370(dev 이미지)
- 선행 조건: #399(주문 접수 초기값)
