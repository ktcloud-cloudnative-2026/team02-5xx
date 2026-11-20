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
| 팀 라벨 | `commonLabels`·`grafana.extraLabels`·`kube-state-metrics.customLabels`·`prometheus-node-exporter.commonLabels`에 `team: team02` | 서브차트는 본 차트의 `commonLabels`를 받지 않는다 |

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

## 렌더링 결과 (103개)

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
| `monitoring` | PrometheusRule (30), ConfigMap (27), ServiceMonitor (8), Service (6), ServiceAccount (6), Deployment (3), Secret (2), DaemonSet (1), Prometheus (1), Alertmanager (1), Role (1), RoleBinding (1) |

- 모든 namespace 리소스는 `monitoring`에 만들어진다. 다른 namespace에 만드는 리소스는 없다.
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
- **Operator의 클러스터 범위 Secret 권한**은 Prometheus·Alertmanager 설정 Secret을 만들고, ServiceMonitor가 참조하는 인증 Secret을 읽기 위한 차트 기본 동작이다. 감시 namespace를 제한(`prometheusOperator.namespaces`)해 줄이는 방안은 후속으로 검토한다.
- 전체 rules는 렌더링 결과에서 확인할 수 있다(`kind: ClusterRole` 검색).

### 기본 수집 대상 (ServiceMonitor 8개)

apiserver, kubelet(cAdvisor 포함), kube-state-metrics, node-exporter, Prometheus, Alertmanager, Operator, Grafana. 서비스(`/actuator/prometheus`)·RabbitMQ 수집은 아래 후속에서 추가한다.

## dev 적용 (병합 후)

`t2-dev-cp`에서, **병합 커밋 전체 SHA**로 진행한다(`deploy/argocd/README.md`와 같은 방식).

1. 접속 확인: `hostname`(t2-dev-cp), `kubectl config current-context`
2. Grafana 관리자 Secret 생성 (값은 문서·채팅·Git에 남기지 않는다)
   ```bash
   kubectl -n monitoring create secret generic grafana-admin \
     --from-literal=admin-user=admin --from-literal=admin-password='<비밀번호>'
   ```
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

- CRD 10개는 차트에 고정된 파일이라 `team: team02` 라벨이 없다.
- `local-path` 저장소는 Pod가 처음 뜬 노드에 고정되고 확장할 수 없다. 그 노드에 문제가 생기면 지표가 사라질 수 있다(dev 한정 감수).
- 알림 채널(#138 결정 요청)이 정해지기 전까지 Alertmanager는 기본 설정이며, 알림은 화면에서만 확인한다.
- etcd·scheduler·controller-manager·kube-proxy·CoreDNS는 수집하지 않는다.

## 후속

- **RabbitMQ 큐별 지표**: 정진혁 님이 `rabbitmq.yaml`(15692 `prometheus` 포트)·NetworkPolicy(`monitoring` → 15692)를 별도 PR로 진행(#176). 적용 후 RabbitMQ ServiceMonitor(`/metrics/detailed?family=queue_coarse_metrics`)와 DLQ 알림 추가
- 서비스 `/actuator/prometheus` ServiceMonitor, `docs/observability.md` 4절 알림 규칙, 대시보드, `docs/runbook.md`
- Operator 감시 namespace 제한 검토, CoreDNS(기존 kube-dns Service) 수집 검토
- Loki·Alloy(로깅), prod 구성
