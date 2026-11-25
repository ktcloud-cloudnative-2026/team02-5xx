# 관측 설계

[← README](../README.md)

> 모든 서비스가 같은 이름·형식·기준으로 지표와 로그를 내보내기 위한 공통 규칙입니다(#138).
>
> 항목마다 **합의됨**(근거 PR·이슈 있음) / **제안**(이 문서로 합의 요청) / **미정**(플랫폼 설치 후 또는 팀 결정 후 확정)을 표시합니다.
> 이번 범위: 문서만. Cooking 적용, Prometheus·Grafana·Loki·Alloy 설치, 알림 규칙·런북 작성은 별도 이슈로 진행합니다.

## 1. 공통 지표 (모든 서비스) — 골든 시그널: 트래픽 · 에러 · 지연 · 포화

### 1-0. 서비스 이름 규칙
- Java 서비스는 `<이름>-service`로 통일한다. (예: `cooking-service`) 프론트엔드는 `web-frontend`, 공통 인프라는 컴포넌트 이름(예: `rabbitmq`)을 쓴다.
- 같은 값을 `spring.application.name`, K8s `app` 라벨, 컨테이너 이름에 쓴다.
  → Prometheus(`application`), K8s 지표(`container`), Loki(`app`)에서 같은 이름으로 찾을 수 있다.
- 현재 6개 Java 서비스의 `spring.application.name`과 기존 매니페스트(`auth-service`, `web-frontend`)는 모두 이 규칙을 따른다.

### 1-1. 지표

| 신호 | 지표 | Prometheus 쿼리 | 출처 | 상태 |
|---|---|---|---|---|
| 트래픽 | 초당 요청 수 | `sum by (application) (rate(http_server_requests_seconds_count{uri!~"/actuator.*"}[5m]))` | 앱 (Actuator) | 제안 |
| 에러 | 5xx 비율 | `sum by (application) (rate(http_server_requests_seconds_count{status=~"5..", uri!~"/actuator.*"}[5m])) / sum by (application) (rate(http_server_requests_seconds_count{uri!~"/actuator.*"}[5m]))` | 앱 | 제안 |
| 지연 | p95 응답 시간 | `histogram_quantile(0.95, sum by (application, le) (rate(http_server_requests_seconds_bucket{uri!~"/actuator.*"}[5m])))` | 앱 (아래 histogram 설정 필요) | 제안 |
| 포화 | DB 커넥션 사용률 | `max by (application) (hikaricp_connections_active / hikaricp_connections_max)` | 앱 | 제안 |
| 포화 | CPU 사용량 (코어) | `max by (container) (rate(container_cpu_usage_seconds_total{namespace="peakorder", container!=""}[5m]))` | K8s (cAdvisor) | 미정 — 플랫폼 설치 후 이름 확인 |
| 포화 | 메모리 사용량 | `max by (container) (container_memory_working_set_bytes{namespace="peakorder", container!=""})` | K8s (cAdvisor) | 미정 — 〃 |
| 포화 | 재시작 수 (15분) | `increase(kube_pod_container_status_restarts_total{namespace="peakorder"}[15m])` | K8s (kube-state-metrics) | 미정 — 〃 |

- CPU·메모리는 서비스(`container`)별로 가장 많이 쓰는 Pod를 본다. Pod 하나하나는 대시보드에서 `by (pod)`로 펼쳐 본다.
- **대시보드에만 두는 지표** (알림 기준 아님): JVM 힙 `jvm_memory_used_bytes{area="heap"}`, GC 시간 `jvm_gc_pause_seconds`(메모리 누수·GC 원인을 찾을 때), DB 연결 대기 요청 수 `hikaricp_connections_pending`(사용률이 100%가 되기 전에 막힘을 먼저 본다).

대시보드: Grafana "서비스 공통" 대시보드 (플랫폼 설치 후 링크)

### 1-2. 모든 Java 서비스 공통 설정

**필요한 의존성** — 설정만으로는 `/actuator/prometheus`가 열리지 않는다. 아래 두 줄이 있어야 한다(Cooking·Order와 같은 선언).
```gradle
implementation 'org.springframework.boot:spring-boot-starter-actuator'    // health, metrics
runtimeOnly 'io.micrometer:micrometer-registry-prometheus'                // /actuator/prometheus
```

| 서비스 | actuator | micrometer-registry-prometheus |
|---|---|---|
| auth, menu | 추가 필요 | 추가 필요 |
| inventory, payment | 있음 | 추가 필요 |
| order, cooking | 있음 | 있음 |

- 2026-11-19 main 기준. Prometheus는 확정 기술 스택(CLAUDE.md 1절)이지만 의존성 추가이므로, 각 서비스 담당이 **자기 서비스 PR에서** 추가한다.

`application.yml`을 쓰는 서비스:
```yaml
spring:
  application:
    name: <서비스>-service        # 예: cooking-service — 지표·로그의 서비스 이름
management:
  endpoints:
    web:
      exposure:
        include: health,info,prometheus
  metrics:
    tags:
      application: ${spring.application.name}   # 모든 지표에 서비스 이름 라벨
    distribution:
      percentiles-histogram:
        http.server.requests: true               # p95를 Pod 여러 개 합쳐 계산하기 위해
```

`application.properties`를 쓰는 서비스(auth, menu):
```properties
spring.application.name=<서비스>-service
management.endpoints.web.exposure.include=health,info,prometheus
management.metrics.tags.application=${spring.application.name}
management.metrics.distribution.percentiles-histogram.http.server.requests=true
```

- 위 속성 이름은 Spring Boot 4.1.2(`spring-boot-micrometer-metrics`)에서 확인했다.

**적용 확인** — 서비스를 띄운 뒤 아래 결과에 `application="<서비스>-service"`가 붙어 있고, `_bucket` 줄이 보여야 한다.
```bash
curl -s localhost:<포트>/actuator/prometheus | grep -E "http_server_requests_seconds_(count|bucket)" | head
```

### 1-3. 규칙
- 에러율은 **5xx만** 센다. 4xx는 사용자 입력·업무 거절(예: 409)이라 서비스 장애가 아니다. 업무 거절 급증은 2절 업무 지표로 본다.
- `/actuator/**` 요청은 제외한다. Prometheus 수집·K8s probe 요청이 트래픽과 지연을 왜곡하기 때문이다.
- 집계 구간은 5분(`[5m]`)을 기본으로 한다.
- **Counter 지표는 반드시 `rate()`나 `increase()`로 감싼다.** Counter는 누적값이라 그대로 그리면 계속 오르는 선만 나온다. (`*_total`, `*_count`, `*_sum`, `*_bucket`)
- K8s 지표는 `container!=""`로 거른다. cAdvisor가 Pod 합계 줄을 따로 내보내서, 빼지 않으면 두 번 더해진다.
- DB 커넥션·CPU·메모리처럼 **Pod마다 따로 있는 자원은 `max`로** 본다. `sum`으로 합치면 한 Pod만 꽉 찬 상황이 가려진다.
- histogram을 켜면 `uri × method × status` 조합마다 버킷이 생겨 지표 수가 늘어난다. 많아지면 `management.metrics.distribution.maximum-expected-value.http.server.requests`로 버킷 상한을 줄인다.
- **DB 서버 전체 연결 수 — 후속(미정)**: `hikaricp_*`는 각 앱의 연결 풀만 본다. t2-db 한 대에 dev·prod DB 12개가 있고 Hikari 기본 풀은 Pod당 10개라, 서비스 6개 × 환경 2개만으로도 PostgreSQL 기본 `max_connections`(100)를 넘을 수 있다. 서비스별 `maximum-pool-size` 기준과 DB 서버 쪽 전체 연결 수 감시(postgres_exporter 등)는 DB 담당(남규리 님)과 후속으로 정한다(#146 리뷰).

## 2. 업무 지표 (서비스별)

> 근거: [성공 기준](plan.md#5-성공-기준-숫자로)이 아직 비어 있어, 각 서비스 요구사항과 이벤트 계약(#52)에서 가져온다. 성공 기준이 정해지면 다시 맞춘다.

### 2-1. 규칙
- 이름은 서비스 이름으로 시작한다. 코드(Micrometer)에서는 `cooking.tickets`처럼 점으로 짓고, Prometheus에서는 `cooking_tickets`로 보인다(Counter는 `_total`이 붙는다).
- 상태처럼 값이 몇 개로 정해진 것만 라벨로 쓴다. `orderId`·`userId`처럼 값이 계속 늘어나는 것은 라벨로 쓰지 않는다.
- "지금 몇 개"는 Gauge, "몇 번 일어났나"는 Counter(`rate`·`increase`로 본다).
- DB를 세는 Gauge는 scrape마다 쿼리가 나가므로 **인덱스를 타는 쿼리**로 만든다. Pod마다 같은 DB를 세므로 알림·대시보드에서는 **`max`**로 본다.
- 사용자에게 보이는 값(예: 혼잡도)은 **API와 같은 계산을 재사용**해, 화면과 대시보드 값이 다르지 않게 한다.

### 2-2. 지표

| 서비스 | 지표 (Prometheus) | 종류 | 무엇을 보나 | 상태 |
|---|---|---|---|---|
| Cooking | `cooking_tickets{status="waiting"\|"cooking"}` | Gauge | 지금 주방이 얼마나 밀렸나 | 구현 (#250) |
| Cooking | `cooking_expected_wait_seconds` | Gauge | 지금 주문하면 조리 시작까지 예상 대기(CO-01과 같은 값) | 구현 (#250) |
| Cooking | `cooking_tickets_started_total`, `cooking_tickets_completed_total` | Counter | 처리 속도가 주문 속도를 따라가나 | 구현 (#250) |
| Cooking | `cooking_tickets_canceled_total` | Counter | 취소가 갑자기 늘었나 (Order 취소 흐름 이상 신호, CI-03) | 구현 (#250) |
| Cooking | `cooking_order_confirmed_received_total{result="created"\|"duplicate"}` | Counter | OrderConfirmed(EV-01)가 끊기지 않고 들어오나. `duplicate` 증가는 재발행 신호 | 구현 (#250) |
| Cooking | `cooking_outbox_pending` | Gauge | CookingCompleted(EV-02) 발행이 막혔나 (정상이면 1초 안에 0, 계속 남아 있으면 이상 — 4-2 5번) | 구현 (#250) |
| Cooking | 위치 | — | Counter는 `service/CookingMetrics`(커밋 후 증가), Gauge는 `config/CookingMetricsConfig`(`MeterBinder`). 수집은 ServiceMonitor `cooking-service`(#278) | 구현 (#250) |
| Order | `order_cancel_follow_up_manual_required` | Gauge | 사람이 확인해야 하는 취소 주문 수 | 구현 (#135) |
| Order | `order_outbox_pending` | Gauge | OrderConfirmed(EV-01) 발행이 막혔나 (정상이면 1초 안에 0 — 4-2 5번) | 구현 (#272) |
| RabbitMQ | `rabbitmq_detailed_queue_messages{queue=~".+\\.dlq"}` | Gauge (RabbitMQ) | 처리 못 한 이벤트가 있나 | 합의됨 (#52) |
| Auth · Menu · Inventory · Payment | (담당자 기입) | | | |

## 3. 로그 형식 (모든 서비스 같게)

### 3-1. 형식: Spring Boot 내장 ECS JSON — 제안
- 로그는 표준 출력(stdout)에 **한 줄에 JSON 하나**로 쓴다. 파일에 쓰지 않는다(Alloy가 수집).
- 형식은 Spring Boot 내장 **ECS**(Elastic Common Schema)를 쓴다. 라이브러리 추가 없이 설정 한 줄이다.
- **K8s에서만 켠다.** 로컬 개발은 사람이 읽기 쉬운 기존 텍스트 로그를 그대로 쓴다. 그래서 `application.yml`이 아니라 배포 매니페스트(base Deployment)의 환경 변수로 넣는다.
  ```yaml
  env:
    - name: LOGGING_STRUCTURED_FORMAT_CONSOLE
      value: ecs
  ```
- 로컬에서 확인하려면 `LOGGING_STRUCTURED_FORMAT_CONSOLE=ecs ./gradlew bootRun`.

실제 Cooking 로그(2026-11-19 로컬 확인):
```json
{"@timestamp":"2026-11-19T06:22:51.793Z","log":{"level":"INFO","logger":"com.peakorder.cooking.service.OrderConfirmedService"},"process":{"pid":83015,"thread":{"name":"org.springframework.amqp.rabbit.RabbitListenerEndpointContainer#0-1"}},"service":{"name":"cooking-service","node":{}},"message":"조리 대기열에 등록했습니다 orderId=990001 orderNo=261119-9001 estimatedCookSec=5 queuedAt=2026-11-19T06:22:51.781Z","ecs":{"version":"8.11"}}
```

**필드 대응** (템플릿 이름 → ECS → Loki에서 `| json` 후 이름)

| 의미 | 템플릿 | ECS 필드 | Loki | 비고 |
|---|---|---|---|---|
| 시각 | `time` | `@timestamp` | — (로그 시각으로 쓰임) | **UTC**(`Z`). Grafana가 보는 사람 시간대(KST)로 바꿔 보여 준다 |
| 레벨 | `level` | `log.level` | `log_level` | 대문자 `INFO`·`WARN`·`ERROR` |
| 서비스 | `service` | `service.name` | `service_name` | `spring.application.name`이 자동으로 들어간다(1-0) |
| 요청 ID | `request_id` | (MDC `requestId`) | `requestId` | 다른 키와 같은 camelCase로 바꿈(5-2). 5절 구현 후 실제 위치 확인 — 미정 |
| 내용 | `message` | `message` | `message` | |
| 위치 | — | `log.logger`, `process.thread.name` | `log_logger`, `process_thread_name` | 어느 클래스·스레드에서 남겼는지 |

- Logstash 형식과 비교해 ECS를 고른 이유: 서비스 이름이 설정 없이 들어가고(Logstash 형식에는 없음), 시각이 UTC로 통일되며(Logstash 형식은 `@timestamp`만 +09:00이라 메시지 안 시각과 섞임), 공개 표준이라 필드 이름을 팀이 따로 정할 필요가 없다.

### 3-2. 메시지 쓰는 법 — 제안
- **문장 + `key=value`** 로 쓴다. 예: `조리를 시작했습니다 orderId=990001 orderNo=261119-9001`
- 주문을 따라가는 키는 서비스 공통으로 **API·이벤트와 같은 이름**을 쓴다: `orderId`, `orderNo`, `paymentId`, `eventId`
- Loki에서는 문자열로 찾는다: `{app="cooking-service"} |= "orderId=990001"`
- 키를 JSON 필드로 따로 빼는 방식(SLF4J `addKeyValue`)은 모든 서비스 코드를 바꿔야 해서 이번 범위 밖이다.

### 3-3. 레벨 기준 — 제안

| 레벨 | 언제 | 예 |
|---|---|---|
| ERROR | **사람이 조치해야 할 때**. 요청·이벤트 처리가 실패했고 자동으로 복구되지 않는다 | 이벤트를 DLQ로 보냄, 취소 후속 처리 수동 확인 전환(#135) |
| WARN | 비정상이지만 처리했다(자동 복구·무시) | 중복 이벤트 무시, 표시용 이름이 길어 잘라 저장(#113), 외부 호출 실패 후 재시도 예정 |
| INFO | 업무 흐름의 주요 지점 | 전표 등록, 조리 시작·완료, 주문 확정, 결제 완료 |
| DEBUG | 개발용. 운영에서는 끈다 | 요청 본문 상세 |

- 요청 하나에 INFO를 여러 줄 남기지 않는다. 부하 테스트·피크 때 로그 양이 급증한다.
- 같은 문제를 단계마다 ERROR로 반복하지 않는다. "사람이 조치해야 하는 순간"에 한 번만 남긴다.

### 3-4. 남기면 안 되는 것 (CLAUDE.md 9절)
- 비밀번호, API 토큰, JWT·`Authorization` 헤더, DB·RabbitMQ 접속 비밀값
- 개인정보: 이름, 전화번호, 주소, 이메일
- 숫자 식별자(`orderId`, `userId`, `paymentId`)는 남겨도 된다. 추적에 필요하다.
- 요청·응답 본문을 통째로 남기지 않는다(개인정보가 섞일 수 있다).

### 3-5. 요청 ID가 없는 로그
- RabbitMQ 리스너·스케줄러 로그는 HTTP 요청이 아니라 요청 ID가 없다. 이때는 `orderId`·`eventId`로 이어 본다. 전달 규칙은 5절.

## 4. 알림 기준

### 4-1. 원칙 — 제안
- **증상에 건다.** 사용자·업무에 영향이 있는 것(에러, 처리 못 한 이벤트)만 알림으로 하고, CPU·메모리 같은 원인은 대시보드에서 본다.
- 모든 알림에 **지속 시간(`for`) 또는 집계 구간**(예: `increase(…[15m])`)을 둔다. 순간적으로 튀는 값에는 울리지 않는다.
- 모든 알림에 **런북 링크**를 단다. 대응 방법이 없는 알림은 만들지 않는다.
- 심각도는 두 단계: **critical**(지금 사용자에게 영향, 바로 확인) / **warning**(처리가 쌓이는 중, 업무 시간 안에 확인).
- DB를 세는 지표는 Pod마다 같은 값이므로 `max`로 본다(2-1).
- **값이 없음(No data)과 수집 실패는 다르다.** `up == 0`(2번)은 Prometheus가 이미 찾은 대상의 수집 실패만 잡는다. Pod가 모두 사라지거나 배포가 잘못돼 대상 자체가 없어지면 `up` 시계열도 없어져 결과가 비고, 알림이 울리지 않는다. 대상 누락은 7번 알림과 Grafana 알림의 No data 처리로 따로 다룬다(설치 후 검증 — 미정). 참고: [Grafana: Handle missing data](https://grafana.com/docs/grafana/latest/alerting/guides/missing-data/)
- 업무 지표 알림(5·6번)의 No data는 정상으로 둔다. 서비스가 없어서 값이 없는 경우는 2·7번이 잡는다. DB 조회 실패로 값이 NaN이 되는 경우는 4-2 아래 **감시 한계** 참고.

### 4-2. 알림 목록

| # | 조건 | 지속 | 심각도 | 무엇을 알리나 | 상태 | 대응 문서 |
|---|---|---|---|---|---|---|
| 1 | `max by (queue) (rabbitmq_detailed_queue_messages{queue=~".+\\.dlq"}) > 0` | 1분 | warning | 처리 못 한 이벤트가 DLQ에 들어감 | **합의됨 (#52)** | [runbook `DLQ`](runbook.md#dlq) |
| 2 | `up{namespace="peakorder"} == 0` | 1분 | critical | 서비스가 죽었거나 지표를 가져오지 못함 | **구현 (#339)** — 규칙 `PeakorderTargetDown`(`deploy/platform/monitoring/values.yaml`, `service-health` 그룹). `namespace="peakorder"` 라벨 확인(11/25) | [runbook 공통 확인 순서](runbook.md#공통-확인-순서) |
| 3 | 5xx 비율(1-1) > 5% | 5분 | critical | 서비스가 요청을 처리하지 못함 | 제안 — 기준값은 성공 기준(plan.md 5절)이 정해지면 조정 | [runbook 공통 확인 순서](runbook.md#공통-확인-순서) |
| 4 | `increase(kube_pod_container_status_restarts_total{namespace="peakorder"}[15m]) >= 3` | — (15분 집계 구간이 대신함) | warning | 재시작 반복(메모리 초과·기동 실패) | **구현 (#339)** — 규칙 `PeakorderContainerRestartingRepeatedly`(`service-health` 그룹) | [runbook `CrashLoopBackOff`](runbook.md#crashloopbackoff) |
| 5 | `max(cooking_outbox_pending) > 0`, `max(order_outbox_pending) > 0` (서비스별 규칙) | 5분 | warning | 이벤트 발행이 막힘(정상이면 1초 안에 비워짐) | **구현 (#289)** — 규칙 `CookingOutboxPending`·`OrderOutboxPending`(`deploy/platform/monitoring/values.yaml`). Order는 ServiceMonitor 추가 후 값이 생김 | [runbook `Outbox`](runbook.md#outbox) |
| 6 | `max(order_cancel_follow_up_manual_required) > 0` | 1분 | warning | 사람이 확인해야 하는 취소 주문이 있음 | **구현 (#309)** — 규칙 `OrderCancelFollowUpManualRequired`(`deploy/platform/monitoring/values.yaml`, `outbox-pending` 그룹) | `services/order-service/README.md` 수동 확인 운영 방법 |
| 7 | `kube_deployment_status_replicas_available{namespace="peakorder"} == 0 and on (namespace, deployment) kube_deployment_spec_replicas{namespace="peakorder"} > 0` | 1분 | critical | 서비스 Pod가 하나도 없음(수집 대상 자체가 사라짐 — 2번이 못 잡는 경우) | **구현 (#339)** — 규칙 `PeakorderDeploymentNoAvailablePods`(`service-health` 그룹). kube-state-metrics 방식, 일부러 0개로 줄인 Deployment는 제외 | [runbook 공통 확인 순서](runbook.md#공통-확인-순서) |

- p95 응답 시간은 기준값(SLO)이 정해지기 전까지 **대시보드에서만** 본다.
- **감시 한계 (미정 — 후속 플랫폼 작업)**: DB를 세는 Gauge(5·6번)는 DB 조회가 실패하면 값이 NaN이 되어 `> 0` 조건이 성립하지 않는다(Micrometer가 값 함수 예외를 삼킴, #146 리뷰에서 재현). 업무 요청이 없으면 5xx(3번)도 생기지 않고, 앱과 수집이 살아 있으면 2·7번도 울리지 않는다. **지금 규칙으로는 이 경우의 자동 감지를 보장하지 않는다.**
  - 후속 후보: ① 지표 값이 NaN인지 검사하는 규칙(PromQL `x != x`) ② DB 연결 실패 지표(`hikaricp_connections_timeout_total` 증가) 알림 ③ "요청 없음 + DB 장애" 시나리오 검증

**RabbitMQ 큐별 지표 (1번)** — 2026-11-19 로컬 RabbitMQ 4.3.7에서 확인
- `rabbitmq_prometheus` 플러그인(포트 15692)은 공식 이미지에서 켜져 있다.
- 큐 이름(`queue`) 라벨이 붙은 줄은 `/metrics/per-object`와 `/metrics/detailed?family=queue_coarse_metrics`에서 나온다. 필요한 묶음만 가져오는 **`/metrics/detailed?family=queue_coarse_metrics`** 를 수집한다(플랫폼 PR에서 설정).
  ```
  rabbitmq_detailed_queue_messages{vhost="/",queue="cooking.order-confirmed.dlq"} 0
  ```
- DLQ는 `cooking.order-confirmed.dlq`(Cooking 선언), `order.cooking-completed.dlq`(Order 선언) 두 개다(#52).

### 4-3. 받는 곳 — 미정
- Grafana 알림 연락처(contact point)로 보낸다. 채널은 팀 결정(#138 결정 요청 6) 후 적는다.
- 당분간 critical·warning 모두 같은 채널로 보내고, 심각도는 메시지 제목에 표시한다.

## 5. 코드에 넣을 것 (서비스 담당 체크리스트)

### 5-1. 지표·로그
- [ ] 의존성 `spring-boot-starter-actuator`, `micrometer-registry-prometheus` (1-2 표에서 "추가 필요"인 서비스)
- [ ] `/actuator/prometheus` 노출 (1-2). **Gateway에는 열지 않는다.**
  - 외부 HTTPRoute는 **실제로 공개할 업무 경로만 하나씩** 연결한다. `/api/v1/**` 같은 넓은 범위로 열지 않는다.
  - `/api/v1/admin/**`(STORE_ADMIN 인가 전, #99·#112), `/internal/**`, `/actuator/**`는 연결하지 않는다.
  - 공개 경로 목록은 Gateway 담당이 관리한다.
- [ ] 공통 라벨 `application`, HTTP histogram 설정 (1-2)
- [ ] 배포 매니페스트에 `LOGGING_STRUCTURED_FORMAT_CONSOLE=ecs` (3-1)
- [ ] 업무 지표 (2절, 서비스별)

### 5-2. 요청 ID — 1단계(HTTP) 제안

| 항목 | 규칙 |
|---|---|
| 헤더 이름 | `X-Request-Id` (Gateway에서 생성 가능한지 확인 필요 — #138 결정 요청 3) |
| 만드는 곳 | Gateway가 만들어 붙인다. 헤더 없이 들어온 요청(내부 호출·테스트)은 처음 받은 서비스가 UUID로 만든다 |
| 받은 값 검사 | 영문·숫자·`-`만, 64자 이하. 아니면 버리고 새로 만든다(줄바꿈 등으로 가짜 로그 줄을 만드는 것 방지) |
| 로그 | MDC 키 **`requestId`** → JSON 로그에 필드로 찍힌다. 다른 로그 키(`orderId`, `eventId`)와 같은 camelCase |
| 전달 | 다른 서비스 HTTP 호출 시 같은 헤더를 붙인다(RestClient 인터셉터) |
| 응답 | 응답 헤더 `X-Request-Id`로 돌려준다(사용자·프론트가 문의할 때 쓸 수 있음) |
| 정리 | 요청이 끝나면 `finally`에서 MDC를 지운다. 지우지 않으면 같은 스레드를 쓰는 다음 요청에 이전 값이 남는다 |

- Cooking에 먼저 적용하고, 그 PR을 다른 서비스의 예시로 쓴다(필터 1개 + 인터셉터 1개).

### 5-3. 요청 ID가 없는 처리
- RabbitMQ 리스너·스케줄러는 HTTP 요청이 아니다. 로그에 `orderId`·`eventId`를 남겨 이어 본다(3-5).
- **이벤트에 요청 ID 싣기는 2단계(후속)** 로 미룬다 — **합의됨** (Order 김민규 님 동의, #146 리뷰). Outbox는 발행 스레드가 따로라 저장 시점에 요청 ID를 함께 저장해야 하고, 이는 DB(마이그레이션) 또는 이벤트 계약 변경이라 Order·Cooking 합의가 필요하다(#138 결정 요청 4).
