# Argo CD GitOps

[팀 규칙](../../CLAUDE.md)과 [역할표](../../docs/roles.md)에 따라 승인된 Git 배포 설정을 Argo CD로 동기화한다. 첫 대상은 Auth 초기본의 dev 배포다.

## 확인한 환경

2026-11-18 점검에서 dev `t2-dev-cp`의 Argo CD `v3.6.1` 구성요소가 Running이고 `argocd`, `peakorder` namespace가 Active임을 확인했다. 저장소는 공개되어 있어 읽기 전용 Git 접근에 별도 토큰이 필요하지 않으며, repo-server에서 Git main 조회가 성공했다.

`dev/project.yaml`은 이 저장소와 현재 dev 클러스터의 `peakorder` namespace를 허용한다. 최초 Auth 구성에 필요한 Deployment·Service를 허용하며, 서비스 종류가 늘어나면 필요한 리소스를 리뷰로 추가한다.

`dev/auth-service.yaml`은 main의 `deploy/apps/auth-service/overlays/dev`를 읽는다. Argo CD 관리 리소스의 namespace는 설치 위치인 `argocd`다. 최초 연결은 수동 동기화로 검증했다. Issue #209에서는 현재 등록된 Auth·Cooking·Order·Payment dev Application에 자동 동기화를 설정한다. 실제 활성화는 PR 승인·병합 후 Application 관리 객체를 갱신한 시점부터이며, prod·모니터링은 변경하지 않는다.

## 최초 등록과 리뷰

공통 인프라 변경이므로 PR 검사 통과 및 작성자 외 팀원 1명 승인 후 병합한다. 다음 최초 등록은 승인·병합된 Git 파일로 dev에서 수행한다. dev SSH 별칭과 접속 클러스터를 확인하고, 병합 커밋의 전체 SHA를 사용한다.

```bash
hostname
kubectl config current-context
GITOPS_REVISION='<승인·병합된 전체 커밋 SHA>'
GITOPS_RAW_ROOT="https://raw.githubusercontent.com/ktcloud-cloudnative-2026/team02-5xx/${GITOPS_REVISION}/deploy/argocd/dev"
kubectl apply --dry-run=server -f "${GITOPS_RAW_ROOT}/project.yaml"
kubectl apply --dry-run=server -f "${GITOPS_RAW_ROOT}/auth-service.yaml"
kubectl apply -f "${GITOPS_RAW_ROOT}/project.yaml"
kubectl apply -f "${GITOPS_RAW_ROOT}/auth-service.yaml"
```

이 단계는 Argo CD 관리 객체의 최초 등록이다. Auth Deployment·Service는 Application의 Git 소스를 통해 Argo CD가 반영한다. AppProject의 서버 검증 후 Application을 등록한다.

## 관리 화면 접속

dev SSH 터미널에서 로컬 루프백 포트 전달을 실행한다.

```bash
kubectl -n argocd port-forward --address 127.0.0.1 svc/argocd-server 18443:443
```

Windows의 별도 터미널에서 SSH 터널을 연다.

```powershell
ssh -N -L 127.0.0.1:18443:127.0.0.1:18443 t2-dev-cp
```

브라우저에서 `https://localhost:18443`을 열고 승인된 계정으로 로그인한다. 설치된 내부 인증서와 접속 대상을 확인한다. 비밀번호·세션 토큰은 문서·채팅·로그에 남기지 않는다.

## 첫 dev 동기화와 확인

1. Application의 저장소 URL·main·Auth dev 경로·대상 namespace를 확인한다.
2. Argo CD 화면에서 `auth-service-dev`의 Diff를 확인한다. 대상은 Auth Deployment와 ClusterIP Service다.
3. Sync로 승인된 설정을 반영하고 상태가 Synced·Healthy인지 확인한다.
4. dev에서 실행 상태와 이미지를 조회한다.

```bash
kubectl -n peakorder rollout status deployment/auth-service --timeout=180s
kubectl -n peakorder get deployment auth-service -o jsonpath='{.spec.template.spec.containers[0].image}'
kubectl -n peakorder get pods -l app=auth-service
kubectl -n peakorder port-forward --address 127.0.0.1 svc/auth-service 18080:8080
```

다른 dev 터미널에서 응답을 확인한다.

```bash
curl --fail --silent --show-error http://127.0.0.1:18080/v3/api-docs
curl --fail --silent --show-error --output /dev/null --write-out '%{http_code}\n' http://127.0.0.1:18080/swagger-ui/index.html
```

검증 결과에는 Application의 Git revision, 이미지 SHA, Synced·Healthy 상태와 HTTP 응답을 기록한다. 포트 전달 종료 후 해당 터미널의 프로세스를 종료한다.

## 후속 결정

- dev 자동 삭제·selfHeal의 추가 활성화 여부(이번에는 모두 비활성)
- prod Application, 별도 클러스터 연결과 배포 승인 절차
- 운영 복제본·자원·노출 경로·TLS 및 서비스별 Secret 전달 방식
- Git 이미지 태그 갱신의 자동화 여부

복구는 [Auth 배포 문서](../apps/auth-service/README.md)의 이전 SHA 변경 PR 절차를 따른다.

[Argo CD 최초 연결](https://argo-cd.readthedocs.io/en/stable/getting_started/), [선언형 설정](https://argo-cd.readthedocs.io/en/stable/operator-manual/declarative-setup/), [동기화 설정](https://argo-cd.readthedocs.io/en/stable/user-guide/auto_sync/)을 참고한다.

## 서비스 dev 자동 동기화 — Issue #209

초기 배포 검증을 마친 서비스 dev Application은 다음 정책을 사용한다. 등록 대상은 Auth·Cooking·Order·Payment 4개(#209)와 Inventory·Menu·web-frontend 3개(#290)로, dev 서비스 Application 7개 모두이다. 모니터링 같은 플랫폼 Application과 prod는 이번 변경 대상이 아니다.

```yaml
spec:
  syncPolicy:
    automated:
      enabled: true
      prune: false
      selfHeal: false
      allowEmpty: false
```

- enabled: Git의 배포 설정과 현재 리소스가 달라지면 자동 Sync한다. 승인된 배포 PR 병합이 배포 시작점이 되며 매번 Sync 버튼을 누를 필요가 없다.
- prune=false: Git에서 사라진 리소스를 자동 삭제하지 않는다. 서비스 제거가 필요하면 대상과 삭제 영향을 검토한 별도 변경으로 처리한다.
- selfHeal=false: 서버에서 생긴 차이만을 이유로 자동 복구를 반복하는 옵션은 켜지 않는다. 새 Git 변경에 따른 Sync는 계속 적용되므로 수동 변경을 영구 보존하는 기능은 아니다.
- allowEmpty=false: 빈 대상에 대한 보호를 유지한다.

### 배포 PR 병합 전 준비

자동 Sync는 GitHub Actions의 완료 여부를 직접 조회하거나 기다리지 않는다. 기존 CI 통과·필수 리뷰 절차를 지키고, 이미지 게시가 이미 완료된 고정 SHA 태그와 필요한 Secret·DB 설정을 확인한 배포 PR을 병합한다. 코드 PR의 main 빌드 중 아직 존재하지 않는 이미지 태그를 미리 넣지 않는다.

GHCR에 새 이미지가 생기는 것만으로 실행 버전이 바뀌지 않는다. 해당 서비스 dev Overlay의 이미지 태그도 Git에서 갱신해야 한다. 이미지 태그 갱신 자동화는 이번 작업에 추가하지 않는다.

Inventory #208, 향후 Menu·프론트 배포 등록 시에는 위 설정을 Application에 넣고 해당 서비스의 준비 상태를 검증한다. 기존 syncOptions·ignoreDifferences가 있다면 같은 syncPolicy에 보존한다. Order #205의 RespectIgnoreDifferences=true 및 Deployment /spec/replicas 예외와 함께 사용할 수 있으며, HPA 예외를 지우거나 다른 팀원 PR을 직접 수정하지 않는다.

### 최초 정책 활성화

Application 자체는 이 서비스 Application의 관리 대상에 포함되지 않는다. 따라서 이 파일들이 main에 병합됐다고 기존 Application의 자동 Sync 설정까지 스스로 바뀌지는 않는다. 승인·병합 후 dev 관리자가 정확한 병합 SHA의 **Application 4개만** 갱신한다. Deployment·Gateway 직접 apply나 자동 삭제는 하지 않는다. 일반 서비스 변경은 이후 Argo CD가 Git에서 반영한다.

#290의 Inventory·Menu·web-frontend도 같은 방식으로 병합 SHA의 **Application 3개만** 갱신한다. Inventory는 활성화 시점에 OutOfSync였다면 Git의 desired 이미지가 즉시 배포되고 기동 시 Flyway 마이그레이션이 적용되므로, Inventory 담당 확인 후 활성화하고 Pod Ready·마이그레이션 적용을 확인한다.

활성화 전에 각 Application이 올바른 main/서비스 dev 경로를 보는지, 현재 Diff가 예상한 승인 범위인지 확인한다. 예상하지 못한 미적용 변경이 있으면 정책 적용을 중단하고 원인을 확인한다. 적용 후에는 정책 값, Synced·Healthy, 진행 중 operation·오류와 실행 이미지를 확인한다. OutOfSync가 없는 상태에서 정책만 켠 것은 새로운 자동 배포 동작까지 검증한 결과가 아니므로, 이후 실제 서비스 배포 PR에서 자동 Sync를 확인한다. 검증만을 위한 서비스 이미지·리소스 변경은 만들지 않는다.

### 복구

이전 이미지·설정을 Git의 되돌림 PR로 복구하고 Argo CD가 그 Git 변경을 반영하는 절차를 사용한다. DB 역마이그레이션은 자동 수행하지 않는다. 자동 Sync 정책을 되돌리려면 Application의 automated.enabled를 false로 변경한 PR을 승인·병합하고 관리 객체에도 반영한다. 자동 Sync가 켜진 상태에서 Argo CD의 과거 이력 Rollback 버튼을 기본 복구 절차로 사용하지 않는다.

정책 근거와 옵션 설명: [Argo CD 3.6 자동 동기화](https://argo-cd.readthedocs.io/en/release-3.6/user-guide/auto_sync/).
