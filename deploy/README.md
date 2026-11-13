# deploy

Kubernetes 매니페스트와 Argo CD 설정을 둡니다. 확정 규칙 원본은 [CLAUDE.md](../CLAUDE.md), 담당자는 [역할표](../docs/roles.md)를 확인합니다.

현재 main에는 이 README만 있으며 아래는 앞으로 추가할 구조입니다. 서비스별 Kustomize Base + dev/prod Overlay를 사용합니다.

```text
deploy/
  apps/
    auth-service/
    menu-service/
    inventory-service/
    order-service/
    payment-service/
    cooking-service/
    web-frontend/
  platform/
  argocd/
```

각 `apps/<서비스>/` 디렉터리에 `base/`, `overlays/dev/`, `overlays/prod/`를 둡니다.

- 공통 인프라는 `platform/`, Argo CD Application은 `argocd/`, 이미지 빌드 CI는 `.github/workflows/`에 둡니다.
- 기존 `cluster/`는 클러스터 구축 기록을 위한 경로로 남길 수 있으며, 애플리케이션 배포 구조와 구분합니다.
- 기존의 `deploy/base/`와 `deploy/overlays/<환경>/` 안내는 위 서비스별 경로로 대체합니다.
- Auth·Menu·Inventory·Order·Payment·Cooking 6개와 프론트엔드를 기준으로 합니다. 이전 kitchen·congestion·admin 폴더 예시는 사용하지 않습니다.
- dev/prod는 별도 클러스터이며 Namespace는 `peakorder`입니다.
- 모든 리소스에 `app`, `team: team02` 공통 라벨을 둡니다.
- 이미지 저장소는 GHCR이며 `latest` 태그를 금지하고 명시적 버전 태그를 사용합니다.
- 배포 경로는 항상 **Git PR → Argo CD**입니다. prod에 직접 `kubectl apply` 하지 않습니다.
- GitHub Actions와 Argo CD 설정은 아직 없으므로 이미지 빌드·자동 배포가 현재 동작한다고 가정하지 않습니다.

## 기존 main의 2팀 환경값

아래 값은 기존 안내를 보존한 것입니다. 실제 클러스터 구축·접속 검증 완료를 의미하지 않습니다.

| 항목 | dev | prod |
|---|---|---|
| control plane | 10.10.22.11 | 10.10.22.21 |
| 워커 | 10.10.22.12, .13 | 10.10.22.22, .23 |
| MetalLB 대역 | 10.10.22.100-127 | 10.10.22.200-223 |
| 파드 대역 | 10.244.0.0/16 | 10.244.0.0/16 |

## 상세 확인 필요

- PostgreSQL의 물리 배치: 클러스터 내부 또는 기존 강사 제공 VM(10.10.22.10). 서비스별 독립 DB dev 6개 + prod 6개 규칙은 유지합니다.
- RabbitMQ 배포 방식.
- prod 배포의 추가 승인 절차·자동 동기화 설정. 어떤 방식이든 Git PR → Argo CD 경로를 유지합니다.
- 기존 구축 안내에 언급된 Calico·MetalLB·local-path·Envoy Gateway의 최종 채택과 상세 설정. kubeadm과 Argo CD는 확정 규칙을 따릅니다.

## 비밀정보

admin.conf, kubeconfig, join 토큰, DB 비밀번호·인증 키는 Git·문서·채팅에 올리지 않습니다. Kubernetes Secret의 실제 값도 Git에 저장하지 않습니다. 자격 증명은 GitHub Actions Secrets 등 승인된 저장 수단에서 참조합니다.
