# dev 모니터링 (kube-prometheus-stack)

dev 클러스터 `monitoring` namespace에 Prometheus·Alertmanager·Grafana·kube-state-metrics·node-exporter를 설치하는 구성이다. 설치 방식은 #176에서 정했다(A안: 별도 AppProject + Argo CD가 Helm 차트를 렌더링). 지표·알림 규칙은 [`docs/observability.md`](../../../docs/observability.md)를 따른다.

## 파일

| 파일 | 내용 |
|---|---|
| `deploy/argocd/dev/monitoring-project.yaml` | AppProject `monitoring-dev` — 이 앱이 쓸 수 있는 저장소·namespace·리소스 종류 |
| `deploy/argocd/dev/monitoring.yaml` | Application `monitoring-dev` — 차트(차트 저장소) + values(팀 Git)를 함께 쓰는 다중 소스 |
| `deploy/platform/monitoring/values.yaml` | 차트 기본값에서 바꾼 설정만 |

기존 `peakorder-dev` AppProject는 바꾸지 않는다. 모니터링은 클러스터 범위 권한이 필요해 울타리를 따로 둔다.

## 버전

| 항목 | 버전 |
|---|---|
| 차트 | `kube-prometheus-stack` **93.2.2** (`https://prometheus-community.github.io/helm-charts`) |
| Prometheus Operator·CRD | v0.95.2 |
| Prometheus | `quay.io/prometheus/prometheus:v3.16.0-distroless` |
| Alertmanager | `quay.io/prometheus/alertmanager:v0.35.0` |
| Grafana | `docker.io/grafana/grafana:13.3.1-distroless` (+ `quay.io/kiwigrid/k8s-sidecar:2.14.3`) |
| kube-state-metrics | `registry.k8s.io/kube-state-metrics/kube-state-metrics:v2.20.0` |
| node-exporter | `quay.io/prometheus/node-exporter:v1.12.1-distroless` |

- 차트 버전 선택: 93.x는 CRD·Operator가 모두 v0.95.2로 같다. 93.2.2는 93.2 라인의 마지막 수정판(발행 후 9일)이고, 새로 설치하는 것이라 92.x를 고를 이유가 없다. 이 차트는 CRD가 바뀔 때 메이저 버전이 오른다.
- Kubernetes: 차트 `kubeVersion: >=1.25.0-0`, dev는 v1.37.2.
- 렌더링 확인에는 Argo CD v3.6.1에 내장된 것과 같은 Helm **v4.3.1**을 작성자 PC에서만 사용했다(팀 도구로 추가하지 않음).

## 바꾼 설정 (values.yaml)

| 설정 | 값 | 이유 |
|---|---|---|
| `kubeEtcd`·`kubeScheduler`·`kubeControllerManager`·`kubeProxy` | 끔 (관련 기본 규칙도 끔) | kubeadm은 이 구성 요소를 `127.0.0.1`에만 열어 수집할 수 없다. 켜 두면 DOWN 오탐 알림. kube-proxy는 후속 확인 |
| `coreDns` | 끔 | 차트가 `kube-system`에 Service를 만든다. 이 AppProject는 `monitoring`만 허용 |
| `prometheusOperator.admissionWebhooks`·`tls` | 끔 | webhook 설정·인증서 생성 Job과 그 권한이 생기지 않는다 |
| `prometheusSpec.*SelectorNilUsesHelmValues` | `false` | 다른 namespace(peakorder)의 ServiceMonitor·PodMonitor·PrometheusRule도 읽는다 |
| Prometheus 보관 | `retention: 7d`, `retentionSize: 8GB`, PVC `local-path` 10Gi | `local-path`는 볼륨 확장 불가 → 처음부터 크기와 한도를 정한다 |
| `grafana.rbac.namespaced` + `sidecar.dashboards.searchNamespace` | `true` + `monitoring` | 기본 ClusterRole(클러스터 전체 ConfigMap·Secret 읽기)을 `monitoring` 안의 Role로 좁히고, 대시보드 감시 범위도 맞춘다(기본 `ALL`이면 403) |
| `grafana.testFramework` | 끔 | helm test용 Pod. Argo CD에서 쓰지 않는다 |
| `grafana.admin.existingSecret` | `grafana-admin` | 관리자 계정은 dev에 직접 만든 Secret 참조(Git에 값 없음) |
| `grafana.persistence` | 끔 | dev 1단계. 대시보드는 ConfigMap으로 관리 |
| `kube-state-metrics.collectors` | 기본 목록에서 `secrets`만 제외 | 클러스터 전체 Secret list·watch 권한이 생기지 않는다(`kube_secret_*` 지표 미사용) |
| 공통 라벨 `app`·`team` | 본 차트: `commonLabels.team`(app은 차트가 `kube-prometheus-stack-<구성 요소>`로 붙임) / 서브차트: `grafana.extraLabels`·`kube-state-metrics.customLabels`·`prometheus-node-exporter.commonLabels`에 `app: grafana`·`kube-state-metrics`·`node-exporter` + `team: team02` / Operator가 만드는 Pod: `prometheusSpec`·`alertmanagerSpec.podMetadata.labels`에 `app: prometheus`·`alertmanager` + `team` | CLAUDE.md 8절, `docs/observability.md` 1절(공통 인프라는 컴포넌트 이름). 서브차트는 본 차트의 `commonLabels`를 받지 않는다. 추가 라벨은 selector에 들어가지 않는다(selector는 `app.kubernetes.io/name`·`instance`) |

## 자원

dev 노드(11/20): t2-dev-cp CPU 2·약 3.8Gi(실사용 78%), t2-dev-w1·w2 CPU 4·약 8Gi(실사용 15~18%).

| 구성 요소 | 요청 CPU / 메모리 | 제한 CPU / 메모리 | 개수 |
|---|---|---|---|
| Prometheus | 100m / 512Mi | 1 / 1Gi | 1 |
| Alertmanager | 10m / 32Mi | 100m / 128Mi | 1 |
| Prometheus Operator | 50m / 128Mi | 200m / 256Mi | 1 |
| Grafana | 50m / 128Mi | 500m / 256Mi | 1 (+ sidecar) |
| kube-state-metrics | 20m / 64Mi | 100m / 128Mi | 1 |
| node-exporter | 20m / 32Mi | 100m / 64Mi | 노드마다 1 (cp 포함) |

- node-exporter는 DaemonSet이라 메모리가 빠듯한 cp에도 뜬다 → 제한을 작게 둔다.
- 요청 합계 약 1Gi(node-exporter 3개 포함, sidecar·config-reloader 제외). 실제 사용량을 본 뒤 조정한다.

## 렌더링 결과 (104개)

같은 결과를 다시 보려면:

```bash
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm template monitoring prometheus-community/kube-prometheus-stack --version 93.2.2 \
  --namespace monitoring --include-crds --kube-version 1.37.2 \
  -f deploy/platform/monitoring/values.yaml
```

| 범위 | 종류 (개수) |
|---|---|
| 클러스터 | CustomResourceDefinition (10), ClusterRole (3), ClusterRoleBinding (3) |
| `monitoring` | PrometheusRule (31), ConfigMap (27), ServiceMonitor (9), Service (6), ServiceAccount (6), Deployment (3), Secret (2), DaemonSet (1), Prometheus (1), Alertmanager (1), Role (1), RoleBinding (1) |

- 모든 namespace 리소스는 `monitoring`에 만들어진다. 다른 namespace에 만드는 리소스는 없다.
- `app`·`team` 라벨은 CRD 10개를 뺀 93개 리소스와 Pod 템플릿(Deployment 3·DaemonSet 1)·Operator가 만들 Pod(`podMetadata`)에 모두 있다.
- MutatingWebhookConfiguration·ValidatingWebhookConfiguration·Job·Pod(helm hook)는 없다.
- AppProject 허용 목록은 위 종류와 정확히 같다(빠짐·남음 없음, 스크립트로 대조).
- Prometheus·Alertmanager의 StatefulSet은 Operator가 실행 중에 만든다(Argo CD가 만드는 리소스가 아니라 AppProject 목록에 없다).

### 권한 (RBAC)

| 이름 | 종류 | 주체 (ServiceAccount, `monitoring`) | 권한 요약 | Secret 접근 |
|---|---|---|---|---|
| `monitoring-kube-prometheus-prometheus` | ClusterRole | `monitoring-kube-prometheus-prometheus` | nodes·nodes/metrics·services·endpoints·pods·endpointslices·ingresses `get,list,watch`, `/metrics`·`/metrics/cadvisor` `get` | 없음 |
| `monitoring-kube-state-metrics` | ClusterRole | `monitoring-kube-state-metrics` | 27개 종류 `list,watch` (secrets 제외) | 없음 |
| `monitoring-kube-prometheus-operator` | ClusterRole | `monitoring-kube-prometheus-operator` | monitoring.coreos.com 리소스 관리, statefulsets `get,list,watch,create,update,patch,delete`, services·endpoints·endpointslices 관리, configmaps·secrets 관리, nodes·namespaces 조회, events 생성 | **클러스터 전체 `get,list,watch,create,update,delete`** |
| `monitoring-grafana` | **Role** (`monitoring`) | `monitoring-grafana` | configmaps·secrets `get,list,watch` | `monitoring` 안에서만 읽기 |

- ClusterRoleBinding·RoleBinding은 모두 같은 이름의 Role ↔ 같은 이름의 ServiceAccount 1:1이다.
- **Operator의 클러스터 범위 Secret 권한(`get,list,watch,create,update,delete`)은 현재 그대로 남아 있다.** Prometheus·Alertmanager 설정 Secret을 만들고 ServiceMonitor가 참조하는 인증 Secret을 읽기 위한 차트 기본 동작이다.
  - AppProject의 `monitoring` 대상·종류 제한은 이 ClusterRole의 접근 범위를 줄이지 않는다.
  - `prometheusOperator.namespaces`(예: `monitoring,peakorder`)는 Operator의 **감시 범위만** 줄이고 ClusterRole은 그대로다(렌더링으로 확인). 권한 자체를 줄이려면 차트 RBAC 대신 namespace별 Role을 직접 관리해야 한다.
  - **플랫폼 담당 확인(11/23): dev에서는 차트 기본값 유지에 동의** — [정진혁 님 #185 승인](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/185#pullrequestreview-6015497000). monitoring·peakorder로 좁히는 작업은 고도화 단계 별도 이슈. dev 범위의 판단이며 prod 승인은 아니다.
- 전체 rules는 렌더링 결과에서 확인할 수 있다(`kind: ClusterRole` 검색).

### 수집 대상 (ServiceMonitor 9개)

- 차트 기본 8개: apiserver, kubelet(cAdvisor 포함), kube-state-metrics, node-exporter, Prometheus, Alertmanager, Operator, Grafana
- **RabbitMQ**(#187, values의 `prometheus.additionalServiceMonitors`): `peakorder`의 `app: rabbitmq` Service 포트 `prometheus`(15692, #206), 경로 `/metrics/detailed?family=queue_coarse_metrics`, 30초. 큐 이름(`queue`) 라벨이 붙은 `rabbitmq_detailed_queue_messages` 등을 가져온다. 차트는 추가 ServiceMonitor를 `kind: List`로 감싸 렌더링한다(Argo CD가 풀어서 적용).
- 서비스(`/actuator/prometheus`) 수집은 후속.

### 팀 알림 규칙 (values의 `additionalPrometheusRulesMap`)

| 규칙 | 식 | 지속 | 심각도 | 런북 |
|---|---|---|---|---|
| `RabbitMQDeadLetterQueueNotEmpty` (`docs/observability.md` 4-2 1번, #52) | `max by (queue) (rabbitmq_detailed_queue_messages{queue=~".+\\.dlq"}) > 0` | 1분 | warning | [DLQ](../../../docs/runbook.md#dlq) |

- 알림 채널(#138)이 정해지기 전까지는 Prometheus Alerts·Alertmanager 화면에서만 확인한다.

## dev 적용 (병합 후)

`t2-dev-cp`에서, **병합 커밋 전체 SHA**로 진행한다(`deploy/argocd/README.md`와 같은 방식).

1. 접속 확인: `hostname`(t2-dev-cp), `kubectl config current-context`
2. Grafana 관리자 Secret 생성 — 비밀번호를 명령 인수나 셸 기록에 남기지 않는다
   ```bash
   read -rsp 'Grafana 관리자 비밀번호: ' GF_PW; echo     # 입력이 화면·history에 남지 않음
   kubectl -n monitoring create secret generic grafana-admin \
     --from-literal=admin-user=admin \
     --from-file=admin-password=<(printf '%s' "$GF_PW")  # 값이 아니라 /dev/fd 경로가 인수로 전달됨
   unset GF_PW
   kubectl -n monitoring get secret grafana-admin              # DATA 2 확인(값은 출력하지 않음)
   ```
   비밀번호는 팀 비공개 채널에서 관리하고 문서·댓글·로그에 남기지 않는다.
3. AppProject → Application 순서로 검증 후 등록
   ```bash
   REV='<병합 커밋 전체 SHA>'
   B="https://raw.githubusercontent.com/ktcloud-cloudnative-2026/team02-5xx/${REV}/deploy/argocd/dev"
   kubectl apply --dry-run=server -f "$B/monitoring-project.yaml"
   kubectl apply -f "$B/monitoring-project.yaml"
   kubectl apply --dry-run=server -f "$B/monitoring.yaml"
   kubectl apply -f "$B/monitoring.yaml"
   kubectl get application monitoring-dev -n argocd     # OutOfSync / Missing
   ```
4. Argo CD 화면에서 Diff 확인(위 렌더링 결과와 같은지) → **수동 Sync**(옵션 기본값). 자동 Sync·prune은 쓰지 않는다.

## 확인

```bash
kubectl -n monitoring get pods -o wide                       # 전부 Running, node-exporter는 노드 3개
kubectl -n monitoring get prometheus,alertmanager,pvc        # PVC 10Gi Bound
kubectl -n monitoring port-forward --address 127.0.0.1 svc/monitoring-kube-prometheus-prometheus 9090:9090
#   → http://127.0.0.1:9090/targets : 기본 대상 UP
kubectl -n monitoring port-forward --address 127.0.0.1 svc/monitoring-grafana 3000:80
#   → http://127.0.0.1:3000 : grafana-admin Secret 계정으로 로그인, Prometheus 데이터 소스·기본 대시보드
```

화면은 외부에 노출하지 않는다(HTTPRoute 없음). 내 PC에서 볼 때는 Argo CD와 같은 방식으로 SSH 터널을 연다.

## 한계

- **CRD 10개(`*.monitoring.coreos.com`)는 차트 `crds/`의 고정 파일이라 `app`·`team` 라벨을 붙일 수 없다.** CLAUDE.md 8절 공통 라벨의 **예외로 승인됐다** — [예외 승인 기록(이은제 님, #176, 11/23)](https://github.com/ktcloud-cloudnative-2026/team02-5xx/issues/176#issuecomment-7088798001). 범위는 차트 93.2.2의 이 CRD 10개에 한정하며, 차트 버전을 바꾸거나 CRD가 추가·변경되면 다시 확인한다. 다른 리소스·Pod에는 `app`·`team` 규칙을 그대로 적용한다. (CRD는 클러스터 공용 리소스 종류 정의라 특정 팀 리소스가 아니다.)
- `local-path` 저장소는 Pod가 처음 뜬 노드에 고정되고 확장할 수 없다. 그 노드에 문제가 생기면 지표가 사라질 수 있다(dev 한정 감수).
- 알림 채널(#138 결정 요청)이 정해지기 전까지 Alertmanager는 기본 설정이며, 알림은 화면에서만 확인한다.
- etcd·scheduler·controller-manager·kube-proxy·CoreDNS는 수집하지 않는다.

## 후속

- ~~RabbitMQ 큐별 지표~~ → #206(15692 노출·NetworkPolicy, 정진혁 님) + #187(ServiceMonitor·DLQ 알림)로 반영
- 서비스 `/actuator/prometheus` ServiceMonitor, `docs/observability.md` 4절 알림 규칙, 대시보드, `docs/runbook.md`
- Operator 권한 축소(namespace별 Role 직접 관리) 여부, CoreDNS(기존 kube-dns Service) 수집 검토
- Loki·Alloy(로깅), prod 구성
