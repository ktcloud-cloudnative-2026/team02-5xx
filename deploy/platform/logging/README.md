# dev 로그 수집 (Loki·Alloy)

`peakorder` 서비스 Pod의 로그(stdout)를 Grafana Alloy가 모아 Loki에 저장하고, Grafana에서 지표와 함께 조회한다. 설치 방식은 #293에서 정했다(이슈 #323).

## 파일

| 파일 | 내용 |
|---|---|
| `loki-values.yaml` | Loki 차트 values |
| `alloy-values.yaml` | Alloy 차트 values(수집 설정 포함) |
| `deploy/argocd/dev/logging.yaml` | Argo CD Application `logging-dev`(차트 2개 + 이 저장소의 values) |
| `deploy/argocd/dev/monitoring-project.yaml` | AppProject `monitoring-dev`(공유). 로깅용으로 차트 저장소 2개와 `apps/StatefulSet` 허용을 추가했다 |
| `deploy/platform/monitoring/values.yaml` | Grafana에 Loki 데이터 소스(`grafana.additionalDataSources`) |

- Application은 `monitoring-dev`와 **분리**한다(따로 Sync·롤백, #293 이태훈 님). AppProject는 설치 namespace(`monitoring`)가 같아 공유한다.
- 수동 Sync만 쓴다(`automated` 없음).

## 버전

| 차트 | 저장소 | 버전 | 앱 버전 |
|---|---|---|---|
| `loki` | `https://grafana-community.github.io/helm-charts` | **21.3.1**(2026-11-16) | Loki 3.7.10 |
| `alloy` | `https://grafana.github.io/helm-charts` | **1.15.0**(2026-10-29) | Alloy v1.21.3 |

- Loki OSS 차트는 2026-03-16에 `grafana/helm-charts`에서 `grafana-community/helm-charts`로 옮겨졌다(6.55.0에서 분기). `grafana/loki` 7.x는 Grafana Enterprise Logs 전용이라 쓰지 않는다(차트 README 공지).
- 두 차트 모두 거의 매일·격주로 새 버전이 나와, 게시 후 1~2주 지난 버전으로 고정했다.

## 바꾼 설정

### Loki (`loki-values.yaml`)

| 설정 | 값 | 이유 |
|---|---|---|
| `deploymentMode` | `Monolithic` | Pod 1개. dev 규모(하루 수십 GB 이하)에 맞음 |
| `loki.auth_enabled` | `false` | 단일 테넌트. 켜면 `X-Scope-OrgID` 헤더가 필요 |
| 저장소 | `filesystem`, 스키마 `tsdb` `v13`(인덱스 24h) | 오브젝트 스토리지 없음. 보관 기능은 인덱스 주기 24h에서만 동작 |
| 보관 | `limits_config.retention_period: 72h`, compactor `retention_enabled: true`, `delete_request_store: filesystem` | 3일(하루 로그량 실측 후 확정). 기간이 지나도 `retention_delete_delay`(기본 2h) 뒤에 지워진다 |
| `singleBinary` | replicas 1, PVC `local-path` 5Gi, requests 100m/256Mi, limit 512Mi | 자원 값은 시작값. 설치 후 사용량으로 조정 |
| 끈 것 | read·write·backend(0), gateway, chunksCache·resultsCache·memcached·exporter, lokiCanary, test, rollout_operator | 분산 모드·캐시·시험용 구성 요소. memcached는 메모리를 많이 쓴다 |
| `sidecar.rules.enabled` | `false` | 규칙 사이드카가 **클러스터 전체 `configmaps`·`secrets` 읽기** ClusterRole을 만든다. Loki 알림 규칙은 쓰지 않는다 |
| `rbac.namespaced` | `true` | 사이드카를 끄면 ClusterRole 권한이 비므로 클러스터 단위 RBAC를 만들지 않는다 |
| `commonLabels` | `app: loki`, `team: team02` | 모든 리소스에 공통 라벨 |

### Alloy (`alloy-values.yaml`)

| 설정 | 값 | 이유 |
|---|---|---|
| 배치 | DaemonSet, tolerations 없음 | control-plane taint 때문에 **cp에는 뜨지 않는다**(워커 2개). 앱 Pod는 워커에만 있다 |
| 수집 대상 | `peakorder` namespace, **자기 노드의 Pod만**(`spec.nodeName=$K8S_NODE_NAME`) | 앱 로그만. DaemonSet끼리 중복 수집하지 않게 |
| 수집 방식 | 노드의 `/var/log/pods` **파일을 읽음**(`loki.source.file`) | API 서버를 거치는 방식(`loki.source.kubernetes`)은 로그가 cp를 지나가 cp 부담이 커진다(#293 정진혁 님) |
| hostPath | `/var/log/pods` **읽기 전용 하나** | `/var/log` 전체(`mounts.varlog`) 대신 필요한 경로만 |
| securityContext | `runAsUser: 0`, `privileged: false`, `allowPrivilegeEscalation: false`, `readOnlyRootFilesystem: true`, `capabilities.drop: [ALL]` | `/var/log/pods`는 `root:root 750`, 로그 파일은 `root:root 640`이라 root가 **소유자로** 읽는다. SELinux가 없어 `privileged`·capability가 필요 없다(차트 README는 `privileged: true`를 권장하지만 SELinux 노드까지 고려한 것) |
| `/tmp/alloy` | `emptyDir`(100Mi) | `readOnlyRootFilesystem`이라 읽은 위치(positions)를 쓸 곳이 필요. 노드에 쓰는 hostPath는 쓰지 않는다 |
| 라벨 | `namespace`, `app`(Pod 라벨), `pod`, `container` | `docs/observability.md` 1절. 라벨을 늘리면 Loki 색인이 커진다 → 요청 ID 등은 조회 때 `| json`으로 찾는다 |
| 파싱 | `stage.cri`로 containerd 접두어만 떼고 **원문 저장** | ECS JSON 서비스와 텍스트 로그 서비스가 섞여 있고, JVM의 `Picked up JAVA_TOOL_OPTIONS` 줄은 JSON이 아니다(#274). 수집 단계에서 버리지 않는다 |
| 전송 | `http://loki.monitoring.svc.cluster.local:3100/loki/api/v1/push` | 같은 namespace. NetworkPolicy 변경 없음(`monitoring`에는 기본 차단이 없다, #293) |
| `crds.create` | `false` | CRD를 설치하지 않는다(11/23 cp 장애 교훈) |
| RBAC | ClusterRole: `pods`·`namespaces`의 `get`·`list`·`watch`만 | #293 **B안**(이태훈 님). 기본값은 `secrets`·`configmaps`를 포함한 넓은 권한이다. 차트 템플릿이 빈 `clusterRules`를 처리하지 못해 `namespaces` 읽기를 둔다 |
| `service.enabled` | `false` | Alloy UI·지표용 Service. 로그는 Alloy가 Loki로 보내는 방식이라 필요 없고, Alloy 지표 수집은 합의 범위가 아니다 |
| `enableReporting` | `false` | Grafana Labs로 익명 사용 통계를 보내지 않는다 |

## 렌더링 결과 (12개)

```bash
helm template loki grafana-community/loki --version 21.3.1 -n monitoring -f deploy/platform/logging/loki-values.yaml
helm template alloy grafana/alloy --version 1.15.0 -n monitoring -f deploy/platform/logging/alloy-values.yaml
```

| 차트 | 종류 (개수) |
|---|---|
| Loki (7) | StatefulSet (1), Service (3), ConfigMap (2), ServiceAccount (1) |
| Alloy (5) | DaemonSet (1), ServiceAccount (1), ConfigMap (1), ClusterRole (1), ClusterRoleBinding (1) |

- **CRD 0개**(`--include-crds`로도 0개). Webhook·Job 없음.
- 모든 리소스는 `monitoring` namespace(ClusterRole·Binding은 클러스터 단위).
- **`app`·`team` 라벨이 없는 리소스 3개**: Alloy의 ConfigMap, ClusterRole, ClusterRoleBinding. Alloy 차트에 이 리소스들의 추가 라벨 키가 없다. 차트가 지원하는 DaemonSet(`controller.extraLabels`)·Pod(`controller.podLabels`)·ServiceAccount(`serviceAccount.additionalLabels`)에는 붙였다. 이 3개는 **차트 1.15.0 한정 팀장님 예외 승인** 대상이다(#323).
- AppProject `monitoring-dev` 허용 목록과 대조: StatefulSet만 새로 필요해 추가했다. PVC는 StatefulSet 컨트롤러가 만든다.

## dev 적용 (병합 후)

`t2-dev-cp`에서, cp **available 1Gi 이상**을 확인하고 팀 채널에 공지한 뒤 진행한다. 단계마다 `free -m`으로 다시 재고, **available이 300Mi 아래로 내려가거나 `TLS handshake timeout`이 나면 멈춘다.**

0. **AppProject 선적용**(병합 전, 이태훈 님): `monitoring-project.yaml`의 `sourceRepos`·`StatefulSet` 변경. Application이 참조하는 저장소가 허용되지 않으면 Sync가 거부된다.
1. 접속·여유 확인
   ```bash
   hostname
   free -m | awk 'NR==2{print "available:",$7,"Mi"}'
   ```
2. Application 등록(Argo CD가 Application 파일을 관리하지 않으므로 한 번 직접 적용)
   ```bash
   REV='<병합 커밋 전체 SHA>'
   B="https://raw.githubusercontent.com/ktcloud-cloudnative-2026/team02-5xx/${REV}/deploy/argocd/dev"
   kubectl apply --dry-run=server -f "$B/logging.yaml"
   kubectl apply -f "$B/logging.yaml"
   kubectl get application logging-dev -n argocd     # OutOfSync / Missing
   ```
3. `logging-dev` Sync(터미널로 요청할 때는 `syncOptions`를 **명시**한다 — `kubectl patch`는 앱의 syncOptions를 담지 않는다)
   ```bash
   kubectl -n argocd patch application logging-dev --type merge -p '{"operation":{"sync":{"syncOptions":["ServerSideApply=true"]}}}'
   ```
4. Grafana 데이터 소스: `monitoring-dev`에서 ConfigMap 하나만 선택 Sync. Loki가 뜬 **뒤에** 한다. Grafana Pod는 재시작되지 않고 데이터 소스 사이드카가 다시 불러온다.
   ```bash
   kubectl -n argocd patch application monitoring-dev --type merge -p '{"operation":{"sync":{"syncOptions":["ServerSideApply=true"],"resources":[{"group":"","kind":"ConfigMap","name":"monitoring-kube-prometheus-grafana-datasource","namespace":"monitoring"}]}}}'
   ```

## 확인

```bash
kubectl -n argocd get application logging-dev -o jsonpath='{.status.sync.status} {.status.health.status}{"\n"}'
kubectl -n monitoring get pods -o wide | grep -E 'loki|alloy'     # loki-0 1/1, alloy 2개(t2-dev-w1·w2), cp에는 없음
kubectl -n monitoring get pvc | grep loki                         # 5Gi Bound
kubectl -n monitoring logs ds/alloy -c alloy --since=5m | grep -i -E 'error|denied|permission' | tail -5
```

Grafana(port-forward, 겹치지 않는 포트 사용 — cp의 3000·18082 등은 이미 쓰이는 경우가 있었다) → Explore → 데이터 소스 **Loki**:

```logql
{namespace="peakorder", app="cooking-service"}
{namespace="peakorder", app="cooking-service"} | json | log_level="ERROR"
```

- 필드 이름은 `docs/observability.md` 3-1 대응표(`log.level` → `log_level`, `service.name` → `service_name`)를 따른다.
- Pod를 재시작한 뒤에도 이전 Pod의 로그가 조회되면 정상이다.
  11/25 #349로 Cooking Pod가 교체된 뒤 아래 쿼리에서 종료된 Pod(`2t2wq`)와 새 Pod(`q8j4d`)가 함께 조회됐다(#347).
  ```logql
  sum by (pod) (count_over_time({namespace="peakorder", app="cooking-service"}[6h]))
  ```
- **안 보이면 시간 범위부터 넓힌다.** 로그는 받은 시각이 아니라 **원래 찍힌 시각**으로 저장된다. 조용한 서비스(예: 주문이 없을 때의 Cooking)는 기본 범위(Last 1 hour)에 0줄일 수 있다.
- Grafana 접속 예: cp에서 `kubectl -n monitoring port-forward svc/monitoring-grafana 13000:80`, 내 PC에서 `ssh -L 13000:localhost:13000 lab@t2-dev-cp` → `http://localhost:13000`. 같은 `lab` 계정을 쓰므로 사람마다 포트를 다르게 한다.

### 설치·재시작 직후 보이는 정상 경고

- **Alloy `final error sending batch … status=400 … timestamp too old`**: Alloy가 처음 뜰 때(또는 재시작 뒤) 노드에 남은 로그를 처음부터 읽어 보내고, Loki가 **7일보다 오래된 줄만** 거부한 것이다. 최근 줄은 저장된다. 과거 로그를 다 읽으면 멈춘다.
- **Loki `failed to resolve loki-memberlist… no such host`**: headless Service는 Ready가 된 Pod만 DNS에 올리므로, Loki가 Ready 되기 전 자기 자신을 찾다 나는 경고다. Ready 뒤 재시작 없이 사라진다.

## 한계

- **보관은 기간 기준뿐**이다. Loki(OSS)에는 용량 기준 삭제가 없다.
- local-path PVC는 **hostPath 방식이라 `5Gi`가 실제 용량 한도가 아니다.** 로그가 많으면 노드 디스크가 찰 수 있다. PVC 사용량 알림(`KubePersistentVolumeFillingUp`)은 hostPath 볼륨의 kubelet 지표가 없어 동작하지 않는다(11/25 확인) → **노드 디스크 알림**(`NodeFilesystemSpaceFillingUp`·`NodeFilesystemAlmostOutOfSpace`)이 감시한다.
- local-path PVC는 Loki Pod가 처음 뜬 노드에 고정되고 확장할 수 없다(dev 한정 감수). **dev에서는 `t2-dev-w2`**(11/25 설치). w2가 내려가면 Loki는 다른 워커로 옮겨 가지 못하고, w2가 돌아올 때까지 로그 저장·조회가 멈춘다(#330 리뷰).
- Alloy의 `/tmp/alloy`는 emptyDir라 **Pod가 다시 만들어지면 읽은 위치를 잊는다.** 재시작 직후 일부 로그가 중복되거나 빠질 수 있다. 위 `timestamp too old` 경고도 이 때문에 재시작 때 다시 보인다.
- Alloy 설정은 ConfigMap 문자열이라 `helm template`으로 문법을 검사하지 못한다. 설치 후 Alloy 로그로 확인한다.
- 실제로 `/var/log/pods` 읽기가 `privileged` 없이 되는지는 cp에서 파일 권한·SELinux로 확인했고, 워커에서는 설치 후 수집 여부로 확인한다.

## 후속

- 하루 로그량 실측 → 보관 기간(3일/2일) 확정
- 런북 공통 확인 순서에 Loki 조회 방법 추가(`kubectl logs`와 병행)
- 설치 후 cp·워커 메모리 기록, 자원 값 조정
- prod 구성(미정)
