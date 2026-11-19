# Payment 서비스 배포

Payment 서비스를 GHCR 이미지와 Argo CD에 연결하는 Kustomize 구성이다. 구조와 이미지 갱신·복구 절차는 [Auth 배포 구성](../auth-service/README.md)과 같다.

## 구조

- `base/`: Deployment 1개, ClusterIP Service 1개 (`payment-service:8080`)
- `overlays/dev/`, `overlays/prod/`: 환경별 이미지 태그
- namespace `peakorder`, 라벨 `app: payment-service`, `team: team02`
- 이미지: `ghcr.io/ktcloud-cloudnative-2026/team02-5xx/payment:sha-c2aa8905bfa703356d2abddc672d58e46a6feb99` (#71 병합 커밋, main CI에서 GHCR 게시 확인)

Payment는 내부 API(PI-01~03)만 제공하므로 Gateway(HTTPRoute)에 연결하지 않는다. Order가 클러스터 안에서 `http://payment-service:8080`으로 호출한다.

## 필요한 Secret (값은 Git에 올리지 않는다)

| 환경 변수 | Secret | 키 | 비고 |
|---|---|---|---|
| `DB_URL` | `payment-service-db` | `DB_URL` | t2-db의 Payment DB JDBC URL |
| `DB_USER` | `payment-service-db` | `DB_USER` | |
| `DB_PASSWORD` | `payment-service-db` | `DB_PASSWORD` | |
| `RABBITMQ_USER` | `rabbitmq-secret` | `username` | 플랫폼 RabbitMQ와 같은 Secret |
| `RABBITMQ_PASSWORD` | `rabbitmq-secret` | `password` | |

`RABBITMQ_HOST`는 플랫폼 Service 이름 `rabbitmq`를 쓴다. `payment-service-db`는 각 클러스터의 `peakorder` namespace에 미리 만들어야 하며, 없으면 Pod가 시작하지 않는다.

## 검사(Probe)

Actuator의 Kubernetes Probe 경로를 쓴다. 클러스터 안에서 실행되면 Spring Boot가 자동으로 켠다.

- 시작: `/actuator/health/liveness` (5초 간격, 최대 2분 대기 — Flyway 마이그레이션 시간 고려)
- 준비: `/actuator/health/readiness`
- 생존: `/actuator/health/liveness`

DB·RabbitMQ 상태는 Probe에 넣지 않는다. 잠깐 끊겨도 Pod가 재시작을 반복하지 않게 하기 위해서다.

## 로컬 확인

```bash
kubectl kustomize deploy/apps/payment-service/overlays/dev
kubectl apply --dry-run=server -k deploy/apps/payment-service/overlays/dev
```

## 후속

- Argo CD Application(`deploy/argocd/dev/payment-service.yaml`)은 별도 PR로 Argo CD 담당 리뷰를 받는다.
- prod 실제 배포, 복제본 수, CPU·메모리 설정은 팀 협의 후 정한다.
