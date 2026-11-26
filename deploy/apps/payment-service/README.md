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

## 연결 풀·종료 보호·Pod 수 관리 — Issue #362

HPA(#186)를 붙이기 전 선행 조건이다. Order(#205, #294)·Inventory(#315)와 같은 방식이다.

- **DB 연결 풀(dev)**: `overlays/dev/hikari-patch.yaml`로 `SPRING_DATASOURCE_HIKARI_MAXIMUM_POOL_SIZE=4`, `SPRING_DATASOURCE_HIKARI_MINIMUM_IDLE=1`을 지정한다. Hikari 기본값은 Pod당 최대 10개라(dev에서 `payment_dev` 연결 10개) Pod가 늘면 DB `max_connections`를 넘는다. prod는 이 패치에 포함하지 않는다(같은 DB 서버라 prod 값은 prod 이슈에서 정한다).
- **종료 보호**: `preStop`(`sleep 10`)과 `terminationGracePeriodSeconds: 50`(preStop 10초 + 앱 정상 종료 대기 30초 + 여유 10초). 앱의 graceful shutdown은 Spring Boot 4.1.2 기본값(`GRACEFUL`, 대기 `spring.lifecycle.timeout-per-shutdown-phase` 30초)이다. 이미지가 `eclipse-temurin:21-jre-alpine`이라 `sleep`을 쓸 수 있다.
- **Pod 수 관리**: Argo CD Application(`deploy/argocd/dev/payment-service.yaml`)은 Deployment의 `/spec/replicas`를 비교에서 제외하고 `RespectIgnoreDifferences=true`로 Sync가 그 값을 되돌리지 않게 한다(자동 동기화 설정은 그대로). 이 파일은 Argo CD가 관리하지 않아 바꾸면 dev에서 `kubectl apply -f deploy/argocd/dev/payment-service.yaml`로 다시 적용해야 반영된다.
- 이 값을 바꾸면 Pod 템플릿이 바뀌어 Pod가 롤링 교체된다(자동 동기화). 다른 서비스 배포와 동시에 병합하지 않는다(DB 연결 예산, #186).
- 다중 Pod 안전성: 결제(PI-01)는 `payments`의 `order_id`·`idempotency_key` UNIQUE로 DB에 한 건만 저장되고, 환불(PI-03)은 결제 행을 `FOR UPDATE`로 잠그며 결제당 완료 환불 1건 유니크 인덱스가 있다(Pod 수와 무관, 정진혁 확인). 2 Pod 시험은 이슈 #362에서 진행한다.

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
- 확인: `kubectl -n peakorder get hpa payment-service`로 현재 사용률(TARGETS)과 Pod 수를 본다. 사용률이 `<unknown>`이면 CPU 지표를 아직 읽지 못한 것이다. 원인은 Pod의 CPU requests 미설정, Pod가 아직 Ready가 아니거나 기동 직후 지표 수집 지연, metrics-server 이상 등일 수 있으므로 `kubectl -n peakorder describe hpa payment-service`의 Conditions·Events와 `kubectl -n peakorder top pod`로 원인을 좁힌다. 2 Pod 시험·부하 시험 결과는 이슈 #362 댓글에 있다.

## 후속

- Argo CD Application(`deploy/argocd/dev/payment-service.yaml`)은 별도 PR로 Argo CD 담당 리뷰를 받는다.
- prod 실제 배포, 복제본 수, CPU·메모리 설정은 팀 협의 후 정한다.
