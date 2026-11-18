# Web Frontend Kubernetes 구성

[Issue #81](https://github.com/ktcloud-cloudnative-2026/team02-5xx/issues/81)의
React + Nginx 정적 파일 서비스 배포 구성입니다.
[공통 규칙](../../../CLAUDE.md)과 [배포 규칙](../../README.md)을 따릅니다.
컨테이너와 이미지 게시 규약은
[Issue #73](https://github.com/ktcloud-cloudnative-2026/team02-5xx/issues/73) /
[PR #79](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/79)를 참고합니다.

## 리소스와 환경

```text
web-frontend/
  README.md
  base/
    deployment.yaml
    service.yaml
    kustomization.yaml
  overlays/
    dev/kustomization.yaml
    prod/kustomization.yaml
```

- Deployment와 ClusterIP Service 이름은 `web-frontend`입니다.
- Namespace는 `peakorder`, 리소스와 Pod의 라벨은
  `app: web-frontend`, `team: team02`입니다.
- Service selector와 Deployment selector는 Pod의 `app: web-frontend`와 일치합니다.
- Service의 TCP 8080은 이름이 `http`인 컨테이너 TCP 8080으로 연결됩니다.
- Readiness와 Liveness는 `http` 포트의 `/index.html`을 HTTP GET으로 검사합니다.
  PR #79의 Nginx가 제공하는 실제 React 진입 파일을 확인하며,
  별도 헬스 API나 백엔드 연결을 요구하지 않습니다.
- Probe 주기와 실패 임계값 등은 Kubernetes 기본값을 사용합니다.
  이미지 실행 명령은 재정의하지 않고 PR #79의 Nginx 실행 구성을 사용합니다.
- dev/prod는 별도 클러스터에 같은 Base를 사용합니다. 현재 Overlay의 구조는
  동일하며 이미지 태그만 환경별로 교체할 수 있습니다.
- 환경별 복제 수, CPU/메모리 requests/limits, 스케줄링 및 추가 보안 정책은
  확정 근거가 없어 지정하지 않았습니다. 배포 전 담당자와 확인해야 합니다.
  Namespace 생성과 이미지 접근 권한도 플랫폼 담당 범위입니다.

## 이미지 태그 교체

현재 모든 이미지 참조는 **미배포 플레이스홀더**입니다.
실제 이미지 SHA 또는 GHCR 게시 성공을 나타내지 않습니다.
플레이스홀더를 유지한 채 동기화하거나 배포하면 안 됩니다.

```text
ghcr.io/ktcloud-cloudnative-2026/team02-5xx/web-frontend:sha-REPLACE_WITH_PUBLISHED_40_CHAR_COMMIT_SHA
```

1. Issue #73 / PR #79의 이미지 CI 연동 및 React 서비스 등록 상태를 확인합니다.
   main의 게시 작업과 GHCR 패키지에서 `web-frontend` 이미지의 게시 성공,
   태그와 출처 커밋을 확인합니다. PR 빌드 성공만으로 게시됐다고 간주하지 않습니다.
2. 대상 환경의 `overlays/dev/kustomization.yaml` 또는
   `overlays/prod/kustomization.yaml`에서 `images[0].newTag`를
   `sha-` 뒤에 실제 게시된 전체 40자리 소문자 16진수 커밋 SHA가 오는 값으로
   교체합니다. 형식은 `^sha-[0-9a-f]{40}$`입니다.
3. Base의 `deployment.yaml`에도 플레이스홀더가 있습니다. Base 자체를 배포
   입력으로 사용할 경우 확인된 게시 태그로 교체해야 합니다.
   Overlay를 사용할 때는 해당 환경의 `newTag`가 Base 태그를 대체합니다.
4. 대상 Overlay를 다시 빌드해 최종 이미지 경로·태그와 플레이스홀더 제거를
   확인합니다. 변경은 Git PR 리뷰를 거쳐 Argo CD 연동 시 반영합니다.

`latest`는 사용하지 않습니다. 이 구성에는 Secret이나 `imagePullSecrets`를
임의로 추가하지 않았습니다. GHCR 공개 범위와 클러스터의 이미지 pull 권한은
담당자 확인이 필요하며 실제 인증정보를 저장소에 기록하지 않습니다.

## 로컬 검증

저장소 루트에서 기존 설치 도구로 실행합니다. 다음 명령은 로컬 렌더링이며
클러스터 접속이나 배포를 수행하지 않습니다.

```powershell
kubectl kustomize deploy/apps/web-frontend/base
kubectl kustomize deploy/apps/web-frontend/overlays/dev
kubectl kustomize deploy/apps/web-frontend/overlays/prod
git diff --check
```

독립 실행형 Kustomize가 있으면 `kubectl kustomize <경로>` 대신
`kustomize build <경로>`를 사용할 수 있습니다.

각 결과에서 다음을 확인합니다.

- Deployment 1개와 Service 1개, 모두 namespace `peakorder`
- 두 리소스 및 Pod의 공통 `app` / `team` 라벨
- Deployment와 Service selector가 Pod 라벨에 일치
- ClusterIP, Service 8080 → `http` → containerPort 8080 연결
- 두 Probe의 `/index.html`, `http` 포트
- 지정 GHCR 경로, 배포 전 실제 게시된 SHA 태그, `latest` 및 플레이스홀더 없음

작성 환경에는 PATH에서 `kubectl` / `kustomize`를 찾을 수 없어 Base와 두
Overlay의 Kustomize 빌드 및 생성 YAML 검증은 미실행입니다.
도구가 준비된 환경에서 위 검증이 필요합니다. 실제 이미지 게시 여부,
컨테이너 기동, Probe 응답, Service 통신 및 dev/prod 배포도 미검증입니다.

## 후속 연동과 범위

Gateway / HTTPRoute / Ingress / TLS, Argo CD Application과 자동 동기화,
Namespace 및 인증정보 준비는 별도 작업입니다. 실제 배포 경로는
**Git PR → Argo CD**이며 이 작업에서는 클러스터에 접근하거나 배포하지 않습니다.
Dockerfile, 이미지 CI, React 소스, 다른 서비스 구성은 변경하지 않습니다.

Kubernetes 변경은 `CLAUDE.md` 6절의 필수 리뷰 대상입니다.
후속 PR 제출 시 GitHub Actions 결과 확인과 작성자 외 팀원 1명의 승인이 필요합니다.
