# platform (공통 인프라)

Redis, RabbitMQ, Gateway, Namespace 등 서비스들이 함께 쓰는 인프라 매니페스트입니다.

## 1. Argo CD 설치 (v3.6.1 고정)
```bash
kubectl create namespace argocd
kubectl apply -n argocd --server-side --force-conflicts \
  -f https://raw.githubusercontent.com/argoproj/argo-cd/v3.6.1/manifests/install.yaml
```
> 일반 `kubectl apply`는 ApplicationSet CRD 크기 제한(256KB) 에러가 나므로 `--server-side`를 사용합니다.

## 2. Namespace 먼저 만들기
Secret을 넣을 `peakorder` 네임스페이스가 있어야 다음 단계가 성공합니다.
```bash
kubectl apply -f namespaces.yaml
```

## 3. Secret 만들기
실제 값은 Git에 올리지 않습니다. 팀 비공개 채널에서 받아 입력하세요.
```bash
kubectl create secret generic redis-secret -n peakorder \
  --from-literal=password='<비밀번호>'

kubectl create secret generic rabbitmq-secret -n peakorder \
  --from-literal=username='<사용자이름>' \
  --from-literal=password='<비밀번호>'
```
> RabbitMQ 아이디·비밀번호는 저장 공간(PVC)이 비어 있는 **첫 기동 때만** 적용됩니다. 이후 `rabbitmq-secret`을 바꿔도 RabbitMQ 비밀번호는 바뀌지 않습니다.
## 4. 나머지 적용
```bash
kubectl apply -f gateway.yaml
kubectl apply -f rabbitmq.yaml
kubectl apply -f redis.yaml
```

## 5. 확인
```bash
kubectl get pod -n peakorder   # rabbitmq-0, redis-0 Running
kubectl get pvc -n peakorder   # data-*-0 Bound
kubectl get pod -n argocd      # 전부 Running
```
## 6. 서비스에서 접속하는 주소
같은 `peakorder` 네임스페이스의 서비스는 아래 주소로 접속합니다. 서비스 배포 시 환경 변수에 넣습니다(앱 기본값 `localhost`는 클러스터에서 동작하지 않음).

| 대상 | 환경 변수 | 값 |
|---|---|---|
| RabbitMQ | `RABBITMQ_HOST` / `RABBITMQ_PORT` | `rabbitmq` / `5672` |

## prod 일회성 예외 적용 기록 (2026-11-20)

강사 제공 prod 공개 주소(`peakorder.jpexstudio.com`, Cloudflare HTTPS → 터널 → prod Gateway IP:80)를 연결하려면 prod에 Gateway가 있어야 합니다. prod에는 아직 Argo CD Application이 없어 **"prod 직접 `kubectl apply` 금지" 규칙의 일회성 예외**로 적용합니다.

| 항목 | 내용 |
|---|---|
| 승인 | 팀장 승인(일회성 예외), Argo CD 담당 확인 |
| 범위 | `namespaces.yaml`, `gateway.yaml` **두 파일만** (아래 고정 커밋 기준) |
| 사전 확인 | prod에 Envoy Gateway(`envoy-gateway` 1/1), MetalLB `prod-pool`(10.10.22.200-10.10.22.223) 설치됨, GatewayClass·Gateway·`peakorder` namespace 없음 |
| 영향 확인 | 적용 전 `kubectl diff`와 `--dry-run=server`로 기존 prod 리소스 변경 여부 확인 |
| 후속 | prod Argo CD Application 구성 시 이 리소스도 GitOps 관리 대상으로 전환 |

적용 명령(prod control plane, main 커밋 고정 — 두 파일은 dev와 같은 내용):
```bash
REV='858184d3dd43f3c71937d005b37e3cbb944859b4'
B="https://raw.githubusercontent.com/ktcloud-cloudnative-2026/team02-5xx/${REV}/deploy/platform"
kubectl diff -f "$B/namespaces.yaml" -f "$B/gateway.yaml"
kubectl apply --dry-run=server -f "$B/namespaces.yaml" -f "$B/gateway.yaml"
kubectl apply -f "$B/namespaces.yaml" -f "$B/gateway.yaml"
kubectl get gateway -A
```

결과(Gateway 상태·ADDRESS, bastion `curl` 응답)는 이 PR 댓글과 팀 채널에 남깁니다. 공개 주소가 붙으면 Gateway를 지우고 다시 만들지 않습니다(IP가 바뀌면 강사에게 알림).
