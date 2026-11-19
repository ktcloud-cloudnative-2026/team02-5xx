# 관측 설계

[← README](../README.md)

> 시작용 예시입니다. 팀에서 정한 내용으로 고치거나, 필요 없으면 지워도 됩니다.
>
> 외부 도구로 써도 됩니다(추천: [Notion](https://www.notion.so)). 그 경우 이 파일에는 링크와 한 줄 요약만 남깁니다.

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
- **대시보드에만 두는 지표** (알림 기준 아님): JVM 힙 `jvm_memory_used_bytes{area="heap"}`, GC 시간 `jvm_gc_pause_seconds`. 메모리 누수·GC 원인을 찾을 때 본다.

대시보드: Grafana "서비스 공통" 대시보드 (플랫폼 설치 후 링크)

### 1-2. 모든 Java 서비스 공통 설정 (라이브러리 추가 없음)

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
| Cooking | `cooking_tickets{status="waiting"\|"cooking"}` | Gauge | 지금 주방이 얼마나 밀렸나 | 제안 |
| Cooking | `cooking_expected_wait_seconds` | Gauge | 지금 주문하면 조리 시작까지 예상 대기(CO-01과 같은 값) | 제안 |
| Cooking | `cooking_tickets_started_total`, `cooking_tickets_completed_total` | Counter | 처리 속도가 주문 속도를 따라가나 | 제안 |
| Cooking | `cooking_tickets_canceled_total` | Counter | 취소가 갑자기 늘었나 (Order 취소 흐름 이상 신호, CI-03) | 제안 |
| Cooking | `cooking_order_confirmed_received_total{result="created"\|"duplicate"}` | Counter | OrderConfirmed(EV-01)가 끊기지 않고 들어오나. `duplicate` 증가는 재발행 신호 | 제안 |
| Cooking | `cooking_outbox_pending` | Gauge | CookingCompleted(EV-02) 발행이 막혔나 (늘기만 하면 이상) | 제안 (#52 후속) |
| Order | `order_cancel_follow_up_manual_required` | Gauge | 사람이 확인해야 하는 취소 주문 수 | 구현 (#135) |
| Order | (담당자 기입) — 예: 발행 대기 이벤트 수 | | | #52 후속 |
| RabbitMQ | DLQ 메시지 수 (`*.dlq` 큐) | RabbitMQ 지표 | 처리 못 한 이벤트가 있나 | 합의됨 (#52) — 지표 이름은 설치 후 확인 |
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
| 요청 ID | `request_id` | (MDC `request_id`) | `request_id` | 5절 구현 후 실제 위치 확인 — 미정 |
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
| 조건 | 받는 사람 | 대응 문서(런북) |
|---|---|---|
| <에러율 5%가 5분 넘음> | | |

## 5. 코드에 처음부터 넣을 것
- [ ] `/metrics` 엔드포인트
- [ ] 요청 ID 헤더를 받아서 다음 서비스로 전달
