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
