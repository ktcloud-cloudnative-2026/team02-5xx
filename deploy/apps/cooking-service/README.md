# Cooking 서비스 배포

Cooking 서비스를 GHCR 이미지와 Argo CD에 연결하는 Kustomize 구성이다. 구조와 이미지 갱신·복구 절차는 [Payment 배포 구성](../payment-service/README.md)·[Auth 배포 구성](../auth-service/README.md)과 같다.

## 구조

- `base/`: Deployment 1개(복제본 1), ClusterIP Service 1개 (`cooking-service:8080`)
- `overlays/dev/`, `overlays/prod/`: 환경별 이미지 태그
- namespace `peakorder`, 라벨 `app: cooking-service`, `team: team02`
- 이미지: `ghcr.io/ktcloud-cloudnative-2026/team02-5xx/cooking:sha-c8f13f69c36633b0cc3d45d84a438f5891d7128c` (#141 병합 커밋, main CI에서 GHCR 게시 확인)

## 포트

Cooking의 로컬 기본 포트는 8084(`application.yml`)다. 클러스터에서는 `SERVER_PORT=8080`으로 바꿔 공통 Dockerfile·다른 서비스와 맞춘다. Order는 `http://cooking-service:8080`으로 호출한다(CI-02·CI-03, 장애 감지).

## 외부 노출

이 구성에는 Gateway(HTTPRoute)를 넣지 않는다.

| 경로 | 권한 | 노출 |
|---|---|---|
| `GET /api/v1/cooking/congestion` (CO-01), `POST /api/v1/cooking/estimates` (CO-02) | 전체(비회원 포함) | 공개 예정 — Gateway 담당과 협의 후 별도 PR |
| `/api/v1/admin/cooking/**` (CO-03·04) | STORE_ADMIN | 연결하지 않음. `COOKING_ADMIN_ENABLED=false`라 경로 자체가 없다(404). #99·#112 확정 후 |
| `/internal/v1/cooking/**` (CI-02·03) | 호출자 Order | 연결하지 않음(클러스터 안에서만) |
| `/actuator/**` | — | 연결하지 않음(Prometheus는 클러스터 안에서 수집) |

## 필요한 Secret (값은 Git에 올리지 않는다)

| 환경 변수 | Secret | 키 | 비고 |
|---|---|---|---|
| `SPRING_DATASOURCE_URL` | `cooking-service-db` | `DB_URL` | t2-db의 Cooking DB JDBC URL (예: `jdbc:postgresql://<호스트>:5432/cooking_dev`) |
| `DB_USER` | `cooking-service-db` | `DB_USER` | `cooking_dev_user` / `cooking_prod_user` |
| `DB_PASSWORD` | `cooking-service-db` | `DB_PASSWORD` | |
| `RABBITMQ_USER` | `rabbitmq-secret` | `username` | 플랫폼 RabbitMQ와 같은 Secret |
| `RABBITMQ_PASSWORD` | `rabbitmq-secret` | `password` | |

- `cooking-service-db`는 각 클러스터의 `peakorder` namespace에 미리 만들어야 하며, 없으면 Pod가 시작하지 않는다. 키 이름은 Payment·Order의 `<서비스>-db` Secret과 같다.
- Cooking `application.yml`은 `DB_HOST`·`DB_PORT`·`DB_NAME`으로 URL을 조립하지만, 클러스터에서는 `SPRING_DATASOURCE_URL`이 이를 덮어쓴다(환경 변수가 `application.yml`보다 우선).

## 그 밖의 환경 변수

| 환경 변수 | 값 | 이유 |
|---|---|---|
| `SERVER_PORT` | `8080` | 위 "포트" |
| `RABBITMQ_HOST` / `RABBITMQ_PORT` | `rabbitmq` / `5672` | 플랫폼 Service 이름. 포트를 명시하고 `enableServiceLinks: false`로 자동 주입(`RABBITMQ_PORT=tcp://…`)을 막는다(#161) |
| `MENU_SERVICE_URL` | `http://menu-service:8080` | CO-02가 Menu MI-01을 호출 |
| `COOKING_ADMIN_ENABLED` | `false` | 관리자 API 비활성. 인증 확정 전 켜지 않는다 |
| `JAVA_TOOL_OPTIONS` | `-XX:MaxRAMPercentage=60.0` | 메모리 제한 안에서 힙 비율. Order(#158)와 같은 기준 |
| `LOGGING_STRUCTURED_FORMAT_CONSOLE` | `ecs` | 로그를 한 줄 JSON(ECS)으로 출력. K8s에서만 켜고 로컬은 텍스트 로그 유지(`docs/observability.md` 3-1, #189). `service.name`에 `cooking-service`가 자동으로 들어감 |
| `SPRING_DATASOURCE_HIKARI_MAXIMUM_POOL_SIZE` / `SPRING_DATASOURCE_HIKARI_MINIMUM_IDLE` | `4` / `1` | DB 연결 풀. t2-db 한 대에 DB 12개(max_connections 100)라 서비스마다 최대 4개, 한가할 때 1개만 유지(#186 예산: 6개 서비스 × 최대 3 Pod × 4 = 72, #222). 기본값은 Pod당 10개 |

## 자원

요청 CPU `100m`·메모리 `384Mi`, 제한 CPU `1`·메모리 `768Mi` (Order와 같은 기준). 실제 사용량을 본 뒤 조정한다.

## 검사(Probe)

Actuator의 Kubernetes Probe 경로를 쓴다.

- 시작: `/actuator/health/liveness` (5초 간격, 최대 2분 — Flyway 마이그레이션 시간 고려)
- 준비: `/actuator/health/readiness`
- 생존: `/actuator/health/liveness`

DB·RabbitMQ 상태는 Probe에 넣지 않는다. 잠깐 끊겨도 Pod가 재시작을 반복하지 않게 하기 위해서다.

## 배포 전후 확인

- **V2 마이그레이션 조건**: V2 적용 전 `status = 'COOKING'` 전표가 1개 이하여야 한다. dev·prod Cooking DB는 새 DB라 V1~V3이 차례로 적용되므로 해당 없다.
- **Order보다 먼저 배포되면**: 조리가 끝나도 CookingCompleted를 받을 큐(`order.cooking-completed`, Order가 선언)가 없어 Outbox에 PENDING으로 쌓이고 1초마다 다시 발행을 시도한다. Order가 배포되면 자동으로 발행된다(로컬에서 같은 동작 확인).
- **Order보다 늦게 배포되면**: Order가 보낸 OrderConfirmed는 받을 큐(`cooking.order-confirmed`, Cooking이 선언)가 없어 되돌아오고, Order는 이를 SENT로 기록하지 않고 다시 발행한다(#52, Order 담당 확인). Cooking이 기동해 큐를 선언하면 다시 발행된 이벤트부터 전달된다. 따라서 두 서비스의 배포 순서와 관계없이 이벤트가 사라지지 않는다.
- **Order와의 관계**: Order는 Cooking 장애 감지(`/actuator/health`)로 신규 주문·결제를 막으므로, Order를 쓰려면 Cooking이 먼저 떠 있어야 한다.

## 로컬 확인

```bash
kubectl kustomize deploy/apps/cooking-service/overlays/dev
kubectl kustomize deploy/apps/cooking-service/overlays/prod
kubectl apply --dry-run=server -k deploy/apps/cooking-service/overlays/dev   # dev 클러스터에서
```

## 후속

- 공개 경로(CO-01·02) HTTPRoute는 Gateway 담당과 협의 후 별도 PR.
- prod 실제 배포, 복제본 수(HPA), 자원 조정은 팀 협의 후 정한다.
