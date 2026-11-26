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

## 자동 확장(HPA, dev) — Issue #362

- `overlays/dev/hpa.yaml`의 HorizontalPodAutoscaler가 CPU 사용률 평균 70%(requests 100m 기준 약 70m)를 목표로 Pod를 1개에서 3개까지 조절한다(이슈 #362, #186 합의값). prod에는 없다.
- Pod 수는 HPA가 정하고, Application의 `ignoreDifferences`(`/spec/replicas`)와 `RespectIgnoreDifferences`가 Sync가 Git의 `replicas: 1`로 되돌리지 않게 한다(위 "연결 풀·종료 보호·Pod 수 관리"). Git의 `replicas: 1`은 HPA가 없을 때의 값이다.
- 축소는 쿠버네티스 기본 안정화(5분)를 따른다. 줄어드는 Pod는 `preStop`(10초)과 `terminationGracePeriodSeconds`(50초)로 요청을 보호한다.
- 확대하면 Pod당 DB 연결이 최대 4개라 서비스당 최대 12개(3 × 4)이고 롤링 중 임시 Pod를 포함한 전체 예산은 `max_connections` 상향(#186, 남규리) 뒤의 값을 따른다. 여러 서비스를 동시에 롤링하지 않는다.
- 확인: `kubectl -n peakorder get hpa payment-service`로 현재 사용률(TARGETS)과 Pod 수를 본다. 사용률이 `<unknown>`이면 CPU 지표(metrics-server) 문제다. 2 Pod 시험·부하 시험 결과는 이슈 #362 댓글에 있다.

## 후속

- Argo CD Application(`deploy/argocd/dev/payment-service.yaml`)은 별도 PR로 Argo CD 담당 리뷰를 받는다.
- prod 실제 배포, 복제본 수, CPU·메모리 설정은 팀 협의 후 정한다.
