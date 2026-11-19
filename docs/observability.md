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

## 2. 업무 지표 (서비스별) — [성공 기준](plan.md#5-성공-기준-숫자로)에서
| 서비스 | 지표 | 왜 |
|---|---|---|
| | | |

## 3. 로그 형식 (모든 서비스 같게)
```json
{"time":"2026-11-04T09:00:00+09:00","level":"info","service":"<서비스>","request_id":"<id>","message":"<내용>"}
```

## 4. 알림 기준
| 조건 | 받는 사람 | 대응 문서(런북) |
|---|---|---|
| <에러율 5%가 5분 넘음> | | |

## 5. 코드에 처음부터 넣을 것
- [ ] `/metrics` 엔드포인트
- [ ] 요청 ID 헤더를 받아서 다음 서비스로 전달
