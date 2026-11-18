# Argo CD GitOps

[팀 규칙](../../CLAUDE.md)과 [역할표](../../docs/roles.md)에 따라 승인된 Git 배포 설정을 Argo CD로 동기화한다. 첫 대상은 Auth 초기본의 dev 배포다.

## 확인한 환경

2026-11-18 점검에서 dev `t2-dev-cp`의 Argo CD `v3.6.1` 구성요소가 Running이고 `argocd`, `peakorder` namespace가 Active임을 확인했다. 저장소는 공개되어 있어 읽기 전용 Git 접근에 별도 토큰이 필요하지 않으며, repo-server에서 Git main 조회가 성공했다.

`dev/project.yaml`은 이 저장소와 현재 dev 클러스터의 `peakorder` namespace를 허용한다. 최초 Auth 구성에 필요한 Deployment·Service를 허용하며, 서비스 종류가 늘어나면 필요한 리소스를 리뷰로 추가한다.

`dev/auth-service.yaml`은 main의 `deploy/apps/auth-service/overlays/dev`를 읽는다. Argo CD 관리 리소스의 namespace는 설치 위치인 `argocd`다. 자동 동기화 설정은 생략하여 Argo CD 기본 수동 동기화로 첫 검증을 진행한다. 이는 초기 구현 선택이며 팀 전체의 영구 배포 정책을 확정하지 않는다.

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

- dev 자동 동기화·prune·selfHeal 사용 여부
- prod Application, 별도 클러스터 연결과 배포 승인 절차
- 운영 복제본·자원·노출 경로·TLS 및 서비스별 Secret 전달 방식
- Git 이미지 태그 갱신의 자동화 여부

복구는 [Auth 배포 문서](../apps/auth-service/README.md)의 이전 SHA 변경 PR 절차를 따른다.

[Argo CD 최초 연결](https://argo-cd.readthedocs.io/en/stable/getting_started/), [선언형 설정](https://argo-cd.readthedocs.io/en/stable/operator-manual/declarative-setup/), [동기화 설정](https://argo-cd.readthedocs.io/en/stable/user-guide/auto_sync/)을 참고한다.
