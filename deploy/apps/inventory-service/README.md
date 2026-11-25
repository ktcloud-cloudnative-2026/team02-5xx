# Inventory 서비스 배포

Inventory 서비스를 GHCR 이미지와 Argo CD에 연결하는 Kustomize 구성이다. 구조와 이미지 갱신·복구 절차는 [Auth 배포 구성](../auth-service/README.md), 구성 방식은 [Order 배포 구성](../order-service/README.md)과 같다.

## 구조

- `base/`: Deployment 1개, ClusterIP Service 1개 (`inventory-service:8080`)
- `overlays/dev/`, `overlays/prod/`: 환경별 이미지 태그. DB 주소는 각 클러스터 Secret의 `DB_URL`이 정하므로 환경별 패치는 없다.
- namespace `peakorder`, 라벨 `app: inventory-service`, `team: team02`
- 이미지: `ghcr.io/ktcloud-cloudnative-2026/team02-5xx/inventory:sha-<머지 커밋 전체 번호>` (`latest` 금지). 현재 태그는 IN-01·03·04·05(#143) 병합 커밋 `df30b94`의 main CI 게시본이며 Flyway V1까지 적용된다. 새 변경이 병합되면 overlay의 태그를 그 커밋으로 올린다.

## 필요한 Secret (값은 Git에 올리지 않는다)

각 클러스터(dev·prod)의 `peakorder` namespace에 미리 만들어야 하며, 없으면 Pod가 시작하지 않는다. 만드는 방법은 [런북](../../../docs/runbook.md#secret-만들기-dev)을 따른다.

| 환경 변수 | Secret | 키 | 비고 |
|---|---|---|---|
| `DB_URL` | `inventory-service-db` | `DB_URL` | t2-db의 Inventory DB JDBC URL (dev `inventory_dev`, prod `inventory_prod`) |
| `DB_USER` | `inventory-service-db` | `DB_USER` | dev `inventory_dev_user`, prod `inventory_prod_user` |
| `DB_PASSWORD` | `inventory-service-db` | `DB_PASSWORD` | |

dev Secret은 2026-11-23 DB 담당이 만들었다(#112). prod Secret 생성 방식은 미정이다.

## 환경 변수

| 환경 변수 | 값 | 비고 |
|---|---|---|
| `MENU_SERVICE_URL` | `http://menu-service:8080` | IN-05에서 MI-02(메뉴 존재 확인) 호출 |
| `INVENTORY_ADMIN_ENABLED` | `"false"` | 관리자 API(IN-02~06)는 STORE_ADMIN 인가(#112) 확정 전까지 켜지 않는다. 켜면 인증 없이 누구나 재고를 바꿀 수 있다 |
| `SPRING_DATASOURCE_HIKARI_MAXIMUM_POOL_SIZE` | `"4"` | t2-db 한 대에 DB 12개(`max_connections` 100)라 연결 풀을 줄인다(#186) |
| `SPRING_DATASOURCE_HIKARI_MINIMUM_IDLE` | `"1"` | 위와 같음 |
| `JAVA_TOOL_OPTIONS` | `-XX:MaxRAMPercentage=60.0` | Order와 같음 |

Inventory는 RabbitMQ를 쓰지 않으므로 RabbitMQ 변수는 없다. `enableServiceLinks: false`는 Order·Payment와 같은 이유로 둔다(#160).

## 네트워크·외부 노출

- `deploy/platform/network-policies.yaml`의 `allow-inventory-service`를 따른다. Order Pod와 `monitoring` namespace에서 8080으로만 들어올 수 있다.
- Gateway `HTTPRoute`는 없다. IN-01(고객 품절 조회)의 외부 노출은 Gateway 구성 때 따로 정한다.

## 자원·검사

- 복제본 1개. 요청 CPU `100m`·메모리 `384Mi`, 제한 CPU `1`·메모리 `768Mi` (Order와 같음). 실제 사용량을 본 뒤 팀 협의로 조정한다.
- 시작: `/actuator/health/liveness` (5초 간격, 최대 2분 대기 — Flyway 마이그레이션 시간 고려)
- 준비: `/actuator/health/readiness`
- 생존: `/actuator/health/liveness`

DB 상태는 Probe에 넣지 않는다. 잠깐 끊겨도 Pod가 재시작을 반복하지 않게 하기 위해서다.

## 종료

Pod가 내려갈 때(롤링 업데이트, 이후 HPA 축소) 진행 중인 요청이 끊기지 않게 하는 설정이다(이슈 #312, #186 하위, Order #294와 같은 방식).

- 앱: Spring Boot 4.1.2의 `server.shutdown` 기본값이 `GRACEFUL`이라 종료 신호를 받으면 새 연결을 거절하고 진행 중인 요청을 끝낸 뒤 종료한다(기본 대기 `spring.lifecycle.timeout-per-shutdown-phase` 30초). 별도 설정은 없다.
- `preStop`: `sleep 10`. Pod가 종료를 시작해도 Service·Gateway가 엔드포인트에서 이 Pod를 빼기까지 시간이 걸려, 그 사이 새 요청이 올 수 있다. 앱이 새 연결을 바로 거절하므로 종료 신호를 10초 늦춰 그 시간을 번다. 이미지가 `eclipse-temurin:21-jre-alpine`이라 `sleep`을 쓸 수 있다.
- `terminationGracePeriodSeconds: 50` = preStop 10초 + 앱 정상 종료 대기 30초 + 여유 10초. 이 시간이 지나면 강제 종료(SIGKILL)된다.
- 이 값을 바꾸면 Pod 템플릿이 바뀌어 Pod가 롤링 교체된다(replicas 1). 여러 서비스를 동시에 롤링하지 않는다(DB 연결 예산, #186).
- Application(`deploy/argocd/dev/inventory-service.yaml`)은 Deployment의 `/spec/replicas`를 비교에서 제외하고 `RespectIgnoreDifferences=true`로 Sync가 그 값을 되돌리지 않게 한다(Order #204와 같은 방식). 이 파일은 Argo CD가 관리하지 않아 바꾸면 dev에서 `kubectl apply -f deploy/argocd/dev/inventory-service.yaml`로 다시 적용해야 반영된다.

## 확인 명령

```bash
kubectl kustomize deploy/apps/inventory-service/overlays/dev
kubectl apply --dry-run=server -k deploy/apps/inventory-service/overlays/dev
kubectl -n peakorder get pods -l app=inventory-service
kubectl -n peakorder logs deploy/inventory-service | grep -i flyway
```

## 후속

- Argo CD Application(`deploy/argocd/dev/inventory-service.yaml`)은 병합 후 [Argo CD README](../../argocd/README.md)의 "최초 등록과 리뷰" 절차로 등록한다.
- IN-02·06(#198, Flyway V2)과 prometheus 의존성(#194)이 병합되면 이미지 태그를 올린다.
