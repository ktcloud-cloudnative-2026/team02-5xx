# Auth 서비스 배포

Auth 초기본을 기존 GitHub Actions 이미지와 Argo CD에 연결한다. Java 21·Spring Boot 설정과 서비스 코드는 서비스 디렉터리에서 관리한다.

## 구조와 현재 검증 범위

`base/`는 Deployment 1개와 ClusterIP Service 1개를 정의한다. `overlays/dev/`와 `overlays/prod/`는 환경별 이미지 버전을 관리한다. 애플리케이션 리소스의 namespace는 `peakorder`이고 `app: auth-service`, `team: team02` 라벨을 사용한다.

초기 이미지는 GHCR 게시가 확인된 `ghcr.io/ktcloud-cloudnative-2026/team02-5xx/auth:sha-317b6ee68bf4cba0f356b5ebdd19abfc02c715d0`이다. 각 환경 Overlay의 `images.newTag`를 갱신한다.

Auth 초기본은 8080 포트와 `/v3/api-docs`, `/swagger-ui/index.html`을 제공한다. 시작·준비·생존 검사는 기존 OpenAPI 응답을 사용한다. DB 설정은 초기본의 의존성과 실행 설정에 포함돼 있지 않다.

## 로컬 확인

```bash
kubectl kustomize deploy/apps/auth-service/base
kubectl kustomize deploy/apps/auth-service/overlays/dev
kubectl kustomize deploy/apps/auth-service/overlays/prod
```

dev 환경에서 아래 명령은 설정 검증에 사용한다.

```bash
kubectl apply --dry-run=server -k deploy/apps/auth-service/overlays/dev
```

## 이미지 갱신과 복구

1. main GitHub Actions의 코드 검사·이미지 게시·CI Final 성공을 확인한다.
2. GHCR에 존재하는 전체 커밋 SHA 태그를 확인한다.
3. 별도 Issue와 브랜치에서 대상 환경의 `images.newTag`만 변경한다.
4. PR에 이미지 SHA와 검증 결과를 기록하고 작성자 외 팀원 1명 승인을 받는다.
5. 병합 후 [Argo CD 절차](../../argocd/README.md)에 따라 대상 환경을 동기화한다.
6. 문제가 있으면 해당 환경 태그를 검증된 이전 SHA로 돌리는 PR을 만들고 같은 리뷰·동기화 절차를 따른다.

prod Overlay는 환경별 이미지 버전을 구분하는 초기 구성을 제공한다. prod Application과 실제 배포, 운영 복제본·자원·승인·자동 동기화 정책은 후속 협의 항목이다. 초기 단일 복제본은 첫 dev 실행 검증을 위한 구성이다.

서비스에 DB·인증 정책이나 OpenAPI 접근 제어가 추가되면 필요한 Secret 참조 및 검사 경로를 함께 검토한다. 비밀값은 Git과 로그에 기록하지 않는다.
