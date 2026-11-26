# Order 서비스 배포

Order 서비스를 GHCR 이미지와 Argo CD에 연결하는 Kustomize 구성이다. 구조와 이미지 갱신·복구 절차는 [Auth 배포 구성](../auth-service/README.md), 구성 방식은 [Payment 배포 구성](../payment-service/README.md)과 같다.

## 구조

- `base/`: Deployment 1개, ClusterIP Service 1개 (`order-service:8080`)
- `overlays/dev/`, `overlays/prod/`: 환경별 이미지 태그
- namespace `peakorder`, 라벨 `app: order-service`, `team: team02`
- 이미지: `ghcr.io/ktcloud-cloudnative-2026/team02-5xx/order:sha-<머지 커밋 전체 번호>` (`latest` 금지). dev 태그는 지표(#272) 병합 커밋 `5f38479`의 main CI 게시본이다(사용자 신원 헤더·역할 검증 #263 포함, 이슈 #300). base·prod는 관리자 주문 조회(OR-08·09, #170) 병합 커밋 `b05b9c0`를 그대로 두며 이 이미지부터 Flyway V6(`idx_orders_ordered_at`)이 적용된다. 새 변경이 병합되면 dev overlay의 태그를 그 커밋으로 올린다.

## 필요한 Secret (값은 Git에 올리지 않는다)

각 클러스터(dev·prod)의 `peakorder` namespace에 미리 만들어야 하며, 없으면 Pod가 시작하지 않는다.

| 환경 변수 | Secret | 키 | 비고 |
|---|---|---|---|
| `DB_URL` | `order-service-db` | `DB_URL` | t2-db의 Order DB JDBC URL (dev `order_dev`, prod `order_prod`) |
| `DB_USER` | `order-service-db` | `DB_USER` | dev `order_dev_user`, prod `order_prod_user` |
| `DB_PASSWORD` | `order-service-db` | `DB_PASSWORD` | |
| `RABBITMQ_USER` | `rabbitmq-secret` | `username` | 플랫폼 RabbitMQ와 같은 Secret |
| `RABBITMQ_PASSWORD` | `rabbitmq-secret` | `password` | |

`RABBITMQ_HOST`는 플랫폼 Service 이름 `rabbitmq`, `RABBITMQ_PORT`는 `5672`로 명시하고 `enableServiceLinks: false`를 둔다. `rabbitmq` Service가 있으면 쿠버네티스가 `RABBITMQ_PORT=tcp://<ClusterIP>:5672`를 자동으로 넣어 앱 설정(`${RABBITMQ_PORT:5672}`)의 숫자 변환이 실패하기 때문이다(Payment에서 Pod 재시작 반복으로 확인됨, #160). DB 접속 정보 이름은 Payment(`payment-service-db`)와 같은 방식이며, 팀 공통 Secret 이름 규칙이 정해지면 `base/deployment.yaml`의 `secretKeyRef` 이름만 바꾼다.

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

- base는 `ORDER_ADMIN_ENABLED=false`를 명시한다. 관리자 API(OR-06~09)는 Gateway JWT(#112 A안)와 서비스의 STORE_ADMIN 검사(#263)가 함께 있어야 켤 수 있고, 켜면 영업·접수 상태 변경과 전체 주문 조회가 가능하다. **dev overlay에서만** `admin-enabled-patch.yaml`로 `true`를 켠다(Issue #398, Inventory #337·Cooking #348·Menu #360과 같은 방식). prod는 base 값 `false`를 유지하고 관리자 Route·SecurityPolicy도 만들지 않는다.
- 고객 경로: base `httproute.yaml`(`order-service`)이 `/api/v1/orders` GET·POST만 Gateway에 연결하고, dev `securitypolicy.yaml`(`order-service-jwt`)이 JWT를 검증한다(#303).
- 관리자 경로(dev 전용, #398): `admin-httproute.yaml`(`order-service-admin`)이 OR-06·07 `/api/v1/admin/store/operations`(GET·PATCH), OR-08 `/api/v1/admin/orders`(GET), OR-09 `/api/v1/admin/orders/{orderId}`(GET)만 연결한다. 고정 경로는 `Exact` + method, `orderId` 경로는 `RegularExpression`이며 `/internal/**`·`/actuator/**`는 열지 않는다. `admin-securitypolicy.yaml`(`order-service-admin-jwt`)이 JWT를 검증하고 `sub`→`X-User-Id`, `role`→`X-User-Role`로 전달하며, STORE_ADMIN 확인은 서비스가 한다. JWT 경로라 `RequestHeaderModifier(remove)`는 넣지 않는다(#286).
- 확인(dev, Gateway `10.10.22.100`): 토큰 없이 관리자 경로는 401, CUSTOMER 토큰은 403, STORE_ADMIN 토큰은 200이다. OR-07로 영업·접수 상태를 바꿨다면 시험 후 원래 값으로 되돌린다. 병합하면 Order Deployment에 환경 변수가 추가되어 롤링된다.

## 자원·검사

- 복제본 1개로 시작한다. 요청 CPU `100m`·메모리 `384Mi`, 제한 CPU `1`·메모리 `768Mi`이며 `MaxRAMPercentage=60`으로 힙을 제한한다. 실제 사용량을 본 뒤 팀 협의로 조정한다.
- DB 연결 풀(dev): `SPRING_DATASOURCE_HIKARI_MAXIMUM_POOL_SIZE=4`, `SPRING_DATASOURCE_HIKARI_MINIMUM_IDLE=1`을 `overlays/dev/hikari-patch.yaml`로 지정한다(이슈 #204, 공통 기준 #186). Hikari 기본값은 Pod당 최대 10개라 Pod가 늘면 DB 서버 `max_connections`(일반 연결 97)를 넘길 수 있어서 DB 담당이 정한 값이며 Auth(#181)와 같다. 이 패치는 dev에만 있고 prod에는 없다(dev·prod가 같은 DB 서버라 prod 값은 prod 이슈에서 정한다). 적용 후에는 `/actuator/prometheus`의 `hikaricp_connections_max`가 4인지 확인한다.
- 시작: `/actuator/health/liveness` (5초 간격, 최대 2분 대기 — Flyway 마이그레이션 시간 고려)
- 준비: `/actuator/health/readiness`
- 생존: `/actuator/health/liveness`

DB·RabbitMQ 상태는 Probe에 넣지 않는다. 잠깐 끊겨도 Pod가 재시작을 반복하지 않게 하기 위해서다.

### 복제본이 여러 개일 때

스케줄러(outbox 발행, 취소 후속 처리)는 DB 행 잠금(`SKIP LOCKED`)과 처리 독점 토큰으로 여러 Pod가 동시에 돌아도 같은 건을 한 번만 처리한다. 다만 수동 확인 지표 `order_cancel_follow_up_manual_required`는 Pod마다 같은 DB를 세므로 알림에서 합계가 아니라 `max`로 묶는다.

### Pod 수와 Argo CD

`order-service-dev` Application은 이 Deployment의 `/spec/replicas`만 비교에서 제외하고(`ignoreDifferences`), Sync 때도 그 값을 보존한다(`RespectIgnoreDifferences=true`. 자동 동기화(`automated`, prune·selfHeal 끔)는 #210 설정을 그대로 유지). 이후 HPA가 Pod 수를 정하거나 2 Pod 시험을 위해 수동으로 늘려도 Sync가 Git의 `replicas: 1`로 되돌리지 않게 하기 위해서다(#186, 이태훈 제안). 이미지·환경 변수·자원 제한은 계속 Git과 맞춘다. Application 파일은 Argo CD가 관리하지 않아, 바꾸면 dev에서 `kubectl apply -f deploy/argocd/dev/order-service.yaml`로 다시 적용해야 반영된다.

## 종료

Pod가 내려갈 때(롤링 업데이트, 이후 HPA 축소) 진행 중인 요청이 끊기지 않게 하는 설정이다(이슈 #294, #186 하위).

- 앱: Spring Boot 4.1.2의 `server.shutdown` 기본값이 `GRACEFUL`이라 종료 신호를 받으면 새 연결을 거절하고 진행 중인 요청을 끝낸 뒤 종료한다(기본 대기 `spring.lifecycle.timeout-per-shutdown-phase` 30초, 4.1.2 jar에서 확인). 별도 설정은 없다.
- `preStop`: `sleep 10`. Pod가 종료를 시작해도 Service·Gateway가 엔드포인트에서 이 Pod를 빼기까지 시간이 걸려, 그 사이 새 요청이 올 수 있다. 앱이 새 연결을 바로 거절하므로(로컬 시험에서 종료 신호 직후 연결 거부 확인), 종료 신호를 10초 늦춰 그 시간을 번다. 이미지가 `eclipse-temurin:21-jre-alpine`이라 `sleep`을 쓸 수 있다.
- `terminationGracePeriodSeconds: 50` = preStop 10초 + 앱 정상 종료 대기 30초 + 여유 10초. 이 시간이 지나면 강제 종료(SIGKILL)된다.
- 로컬 시험(PostgreSQL 16, 임시 DB): 처리 중인 요청(DB 잠금으로 6초 지연)이 종료 신호를 받은 뒤에도 `200`으로 끝났고, 종료 신호 직후의 새 요청은 연결이 거부됐으며, 요청이 끝나자 프로세스가 종료됐다. 로그에 `Commencing graceful shutdown`과 `Graceful shutdown complete`가 남는다. 클러스터에서의 엔드포인트 제거 시간은 dev에서 확인한다.
- 이 값을 바꾸면 Pod 템플릿이 바뀌어 Order Pod가 롤링 교체된다(replicas 1, 자동 동기화).

## 자동 확장(HPA, dev)

- `overlays/dev/hpa.yaml`의 HorizontalPodAutoscaler가 CPU 사용률 평균 70%(requests 100m 기준 약 70m)를 목표로 Pod를 1개에서 3개까지 조절한다(이슈 #225, #186 합의값). prod에는 없다.
- Pod 수는 HPA가 정하고, Application의 `ignoreDifferences`(`/spec/replicas`)와 `RespectIgnoreDifferences`가 Sync가 Git의 `replicas: 1`로 되돌리지 않게 한다(#204). Git의 `replicas: 1`은 HPA가 없을 때의 값이다.
- 축소는 쿠버네티스 기본 안정화(5분)를 따른다. 줄어드는 Pod는 `preStop`과 정상 종료 설정으로 요청을 보호한다(위 "종료").
- 확대하면 Pod당 DB 연결이 최대 4개라 서비스당 최대 12개(3 × 4)이고, 롤링 중 임시 Pod를 포함한 전체 예산은 최대 96이다(일반 연결 97, #186). 여러 서비스를 동시에 롤링하지 않는다.
- 2 Pod 시험(2026-11-25, dev): 같은 주문의 동시 결제 요청에서 결제는 한 번만 처리되고(나머지는 `409`), 주문번호도 한 번만 발급됐다. outbox는 모두 발행(`SENT`)됐고 Cooking의 중복 수신(`duplicate`)은 0이었으며, 취소 후 재고 복원은 한 번이었다. 결과는 이슈 #225 댓글에 있다.
- 확인: `kubectl -n peakorder get hpa order-service`로 현재 사용률(TARGETS)과 Pod 수를 본다. 사용률이 `<unknown>`이면 CPU 지표(metrics-server) 문제다. 부하 시험으로 확대·축소와 requests·목표값을 조정하는 것은 아직 남아 있다.

## 로그

- 환경 변수 `LOGGING_STRUCTURED_FORMAT_CONSOLE=ecs`로 로그를 한 줄에 JSON 하나(ECS) 형식으로 출력한다(이슈 #271, `docs/observability.md` 3-1, Cooking #190과 같은 방식). `application.yml`·코드는 바꾸지 않아 로컬 개발은 기존 텍스트 로그 그대로다. `service.name`에는 `order-service`가 자동으로 들어간다.
- 시각(`@timestamp`)은 UTC다. 예외는 같은 줄의 `error.stack_trace`(`error.message`) 필드에 들어간다.
- 이 변수를 바꾸면 Pod 템플릿이 바뀌어 Order Pod가 롤링 교체된다(replicas 1, 자동 동기화).
- 로그에 남기면 안 되는 것(비밀번호·토큰·개인정보)은 `docs/observability.md` 3-4를 따른다. 로그 확인 명령은 [런북](../../../docs/runbook.md)의 공통 확인 순서를 본다.

## 로컬 확인

```bash
kubectl kustomize deploy/apps/order-service/overlays/dev
kubectl apply --dry-run=server -k deploy/apps/order-service/overlays/dev
```

## 후속

- HPA(dev min 1·max 3·CPU 70% 제안)는 Argo CD dev 프로젝트의 HPA 허용(#186, 정진혁)이 병합된 뒤 추가한다. prod 복제본 수와 DB 풀 값, Gateway 라우트(인증 이후)는 팀 협의 후 정한다.
