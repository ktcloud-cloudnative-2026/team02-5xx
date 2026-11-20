# Order 서비스 배포

Order 서비스를 GHCR 이미지와 Argo CD에 연결하는 Kustomize 구성이다. 구조와 이미지 갱신·복구 절차는 [Auth 배포 구성](../auth-service/README.md), 구성 방식은 [Payment 배포 구성](../payment-service/README.md)과 같다.

## 구조

- `base/`: Deployment 1개, ClusterIP Service 1개 (`order-service:8080`)
- `overlays/dev/`, `overlays/prod/`: 환경별 이미지 태그
- namespace `peakorder`, 라벨 `app: order-service`, `team: team02`
- 이미지: `ghcr.io/ktcloud-cloudnative-2026/team02-5xx/order:sha-<머지 커밋 전체 번호>` (`latest` 금지). 현재 태그는 OR-04 조리 상태(#142) 병합 커밋 `eeee6a2`의 main CI 게시본이다. 새 변경이 병합되면 overlay의 태그를 그 커밋으로 올린다.

## 필요한 Secret (값은 Git에 올리지 않는다)

각 클러스터(dev·prod)의 `peakorder` namespace에 미리 만들어야 하며, 없으면 Pod가 시작하지 않는다.

| 환경 변수 | Secret | 키 | 비고 |
|---|---|---|---|
| `DB_URL` | `order-service-db` | `DB_URL` | t2-db의 Order DB JDBC URL (dev `order_dev`, prod `order_prod`) |
| `DB_USER` | `order-service-db` | `DB_USER` | dev `order_dev_user`, prod `order_prod_user` |
| `DB_PASSWORD` | `order-service-db` | `DB_PASSWORD` | |
| `RABBITMQ_USER` | `rabbitmq-secret` | `username` | 플랫폼 RabbitMQ와 같은 Secret |
| `RABBITMQ_PASSWORD` | `rabbitmq-secret` | `password` | |

`RABBITMQ_HOST`는 플랫폼 Service 이름 `rabbitmq`를 쓴다. DB 접속 정보 이름은 Payment(`payment-service-db`)와 같은 방식이며, 팀 공통 Secret 이름 규칙이 정해지면 `base/deployment.yaml`의 `secretKeyRef` 이름만 바꾼다.

## 다른 서비스 주소

클러스터 안 Service 이름으로 호출한다. 해당 서비스가 같은 이름·포트(`8080`)로 배포돼 있어야 한다.

| 환경 변수 | 값 | 비고 |
|---|---|---|
| `MENU_SERVICE_URL` | `http://menu-service:8080` | MI-01 |
| `INVENTORY_SERVICE_URL` | `http://inventory-service:8080` | II-01~04 (Inventory 배포 구성 전) |
| `PAYMENT_SERVICE_URL` | `http://payment-service:8080` | PI-01·03 |
| `COOKING_SERVICE_URL` | `http://cooking-service:8080` | CI-02·03, 헬스 확인. Cooking 담당(김지윤)이 Cooking 배포에서 Service 이름 `cooking-service`, Service·컨테이너 포트 `8080`, 앱은 `SERVER_PORT=8080`으로 듣게 하겠다고 확인했다(로컬 기본 `8084`는 그대로) |

Inventory·Cooking은 아직 배포 구성이 없다. 해당 서비스가 없으면 Order의 재고·조리 연동이 실패한다(Cooking 장애 감지는 신규 주문·결제를 `503`으로 막는다).

## 관리자 API와 외부 노출

- `ORDER_ADMIN_ENABLED=false`를 명시한다. 관리자 API(OR-06·07)는 인증(STORE_ADMIN, 이슈 #112)이 확정되기 전까지 켜지 않으며, 켜면 인증 없이 누구나 영업·접수 상태를 바꿀 수 있다. 격리되지 않은 dev와 prod에서는 켜지 않는다.
- Gateway `HTTPRoute`는 이 PR에 없다. 사용자 식별이 임시 헤더(`X-User-Id`)이므로 인증 교체 전에는 `/api/v1/orders`를 외부에 열지 않는다([서비스 README](../../../services/order-service/README.md)). Order는 클러스터 안에서만 접근 가능하다.

## 자원·검사

- 복제본 1개로 시작한다. 요청 CPU `100m`·메모리 `384Mi`, 제한 CPU `1`·메모리 `768Mi`이며 `MaxRAMPercentage=60`으로 힙을 제한한다. 실제 사용량을 본 뒤 팀 협의로 조정한다.
- 시작: `/actuator/health/liveness` (5초 간격, 최대 2분 대기 — Flyway 마이그레이션 시간 고려)
- 준비: `/actuator/health/readiness`
- 생존: `/actuator/health/liveness`

DB·RabbitMQ 상태는 Probe에 넣지 않는다. 잠깐 끊겨도 Pod가 재시작을 반복하지 않게 하기 위해서다.

### 복제본이 여러 개일 때

스케줄러(outbox 발행, 취소 후속 처리)는 DB 행 잠금(`SKIP LOCKED`)과 처리 독점 토큰으로 여러 Pod가 동시에 돌아도 같은 건을 한 번만 처리한다. 다만 수동 확인 지표 `order_cancel_follow_up_manual_required`는 Pod마다 같은 DB를 세므로 알림에서 합계가 아니라 `max`로 묶는다.

## 로컬 확인

```bash
kubectl kustomize deploy/apps/order-service/overlays/dev
kubectl apply --dry-run=server -k deploy/apps/order-service/overlays/dev
```

## 후속

- Argo CD Application(`deploy/argocd/dev/order-service.yaml`)은 클러스터에 Secret을 만든 뒤 별도 PR로 Argo CD 담당 리뷰를 받는다.
- Inventory·Cooking 배포 구성과 포트 정리, Gateway 라우트(인증 이후), HPA·prod 복제본 수는 팀 협의 후 정한다.
