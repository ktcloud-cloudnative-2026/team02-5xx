# Menu Service Kubernetes 구성

[Issue #83](https://github.com/ktcloud-cloudnative-2026/team02-5xx/issues/83)의
서비스별 Kustomize 구성입니다.
[공통 규칙](../../../CLAUDE.md)과 [배포 규칙](../../README.md)을 따릅니다.
DB 환경 변수는 [PR #76](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/76),
Java 21 이미지와 태그 규약은
[PR #79](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/79)를 기준으로 합니다.
PR #76·#79와 참고 구성인
[PR #82](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/82)는
모두 main에 병합됐습니다(2026-11-19 확인). 이 브랜치에는 해당 PR의
소스나 파일을 별도로 가져오지 않고 배포 참조만 정의했습니다.
현재 구성은 실제 배포 가능한 상태로 검증되지 않았습니다.

## 구조와 리소스

```text
menu-service/
  README.md
  base/
    deployment.yaml
    service.yaml
    httproute.yaml
    kustomization.yaml
  overlays/
    dev/kustomization.yaml
    prod/kustomization.yaml
```

- Deployment와 ClusterIP Service의 이름은 `menu-service`입니다.
- Namespace는 `peakorder`, 두 리소스와 Pod의 공통 라벨은
  `app: menu-service`, `team: team02`입니다.
- Deployment 및 Service selector는 Pod의 `app: menu-service`와 일치합니다.
- Service TCP 8080 → 이름 `http` → 컨테이너 TCP 8080으로 연결됩니다.
  Spring Boot 기본 포트를 사용하며 이미지의 실행 명령을 재정의하지 않습니다.
- Base에 공통 리소스를 두고 dev/prod Overlay에서 각각 이미지 태그를 지정합니다.
  dev/prod는 독립 클러스터이므로 이름이나 namespace 접미사를 추가하지 않습니다.
- 환경별 복제 수, CPU/메모리 requests/limits, 실제 DB 주소 및 추가 인프라
  정책은 확정 근거가 없어 지정하지 않았습니다. 배포 전 담당자 확인이 필요합니다.

## PostgreSQL Secret 선행 조건

각 dev/prod 클러스터의 `peakorder` namespace에 `menu-service-db` Secret을
별도로 준비해야 합니다. 다음은 이 배포 구성에서 사용하는 이름·키 계약이며,
기존 Secret이 이미 존재한다는 뜻은 아닙니다.

| 컨테이너 환경 변수 | Secret 이름 | Secret 키 | 용도 |
| --- | --- | --- | --- |
| `MENU_DB_URL` | `menu-service-db` | `MENU_DB_URL` | Menu PostgreSQL JDBC URL |
| `MENU_DB_USERNAME` | `menu-service-db` | `MENU_DB_USERNAME` | Menu DB 사용자 |
| `MENU_DB_PASSWORD` | `menu-service-db` | `MENU_DB_PASSWORD` | Menu DB 비밀번호 |

세 환경 변수 모두 `valueFrom.secretKeyRef`로 주입하며 `optional: false`입니다.
Secret이나 키가 없으면 컨테이너를 시작할 수 없습니다.
Secret 리소스 및 실제 값은 이 구성에 포함하지 않습니다.
플랫폼·DB 담당자가 환경별 Menu 전용 DB의 연결 허용, 계정 권한, 자격 증명을
확인하고 승인된 비밀정보 관리 절차로 준비해야 합니다.
DB 주소·계정·비밀번호, Secret 값이나 이를 포함한 생성 명령을 Git에 기록하지 않습니다.

PR #76은 위 환경 변수를 Spring datasource에 연결하고 Flyway를 활성화하며
`ddl-auto=validate`를 사용합니다. 해당 변경이 포함된 이미지와 접근 가능한
PostgreSQL, Flyway 실행에 필요한 권한 및 스키마 준비가 실제 기동의 선행 조건입니다.
DB 환경 변수를 참조하는 것만으로 연결·마이그레이션 성공이 보장되지는 않습니다.
환경 변수로 주입한 Secret 변경은 실행 중 프로세스에 자동 반영되지 않으므로
자격 증명 갱신 시 별도 배포 절차에 따른 Pod 재시작도 필요합니다.

## Probe와 한계

현재 브랜치의 서비스와 병합된 PR #76에는 Spring Boot Actuator 의존성이 없습니다.
Readiness와 Liveness는 `tcpSocket.port: http`로 컨테이너 8080의 포트 개방을
검사합니다. 존재하지 않는 `/actuator/health` HTTP Probe는 사용하지 않습니다.

TCP 연결 성공은 **애플리케이션 포트 개방만 확인**합니다.
DB 연결 상태, Flyway 완료, API 정상 응답 및 업무 준비 완료를 보장하지 않습니다.
특히 DB가 끊겨도 포트가 열려 있으면 Probe가 성공할 수 있습니다.
추가 라이브러리나 서비스 코드 변경은 포함하지 않았습니다.

Probe 주기·실패 임계값 등은 Kubernetes 기본값을 사용합니다.
실제 Spring Boot 기동·DB 초기화 시간을 측정하지 않았으므로 Liveness가 느린
기동 중 재시작을 유발할 수 있습니다. 배포 전 실제 이미지로 기동 시간을 검증하고,
필요하면 담당자와 시작 지연·임계값 또는 Startup Probe를 조정해야 합니다.

## GHCR 이미지 태그 교체

Base와 두 Overlay의 현재 태그는 **미배포 플레이스홀더**입니다.
실제 게시된 이미지 SHA 또는 배포 가능 여부를 나타내지 않습니다.

```text
ghcr.io/ktcloud-cloudnative-2026/team02-5xx/menu:sha-REPLACE_WITH_PUBLISHED_40_CHAR_COMMIT_SHA
```

CI의 `.github/ci/services.json`에서 Menu의 서비스 ID는 `menu`이며,
`docs/ci.md`의 이미지 이름 규칙도 이 ID를 사용합니다.
Base의 이미지 이름과 두 Overlay의 `images[0].name`은 위 경로로 일치해야
`newTag` 치환이 적용됩니다. Kubernetes 리소스 이름은 `menu-service`를 유지합니다.

1. 병합된 PR #76의 DB 변경과 PR #79의 CI를 기준으로 main 게시 작업 및 GHCR에서
   Menu 이미지 게시 성공과 출처 커밋을 확인합니다. PR의 이미지 빌드 성공만으로
   GHCR 게시를 가정하지 않습니다.
2. 대상 환경의 `overlays/dev/kustomization.yaml` 또는
   `overlays/prod/kustomization.yaml`에서 `images[0].newTag`를 실제 게시된
   `sha-<전체 40자리 소문자 16진수 커밋 SHA>`로 교체합니다.
   유효한 배포 태그 형식은 `^sha-[0-9a-f]{40}$`입니다.
3. Overlay의 `newTag`는 Base의 이미지 태그를 대체합니다.
   Base 자체를 배포 입력으로 사용할 경우 `base/deployment.yaml`의
   플레이스홀더도 확인된 게시 태그로 교체해야 합니다.
4. 대상 Overlay를 다시 렌더링하고 최종 이미지 경로·태그와 플레이스홀더 제거를
   확인합니다. `latest`는 사용하지 않습니다.

각 클러스터의 GHCR 이미지 pull 권한과 패키지 공개 범위는 별도 확인이 필요합니다.
`imagePullSecrets`나 실제 인증정보를 임의로 추가하지 않았습니다.

## 로컬 검증

저장소 루트에서 기존 설치 도구로 실행합니다.
다음 명령은 로컬 렌더링만 수행하며 클러스터 접근·배포를 하지 않습니다.

```powershell
kubectl kustomize deploy/apps/menu-service/base
kubectl kustomize deploy/apps/menu-service/overlays/dev
kubectl kustomize deploy/apps/menu-service/overlays/prod
git diff --check
```

독립 실행형 Kustomize가 있으면 `kubectl kustomize <경로>` 대신
`kustomize build <경로>`를 사용할 수 있습니다.

각 렌더 결과에서 다음 항목을 확인합니다.

- Deployment·Service·HTTPRoute 각 1개, namespace `peakorder`
- 리소스 및 Pod의 공통 라벨과 selector 일치
- ClusterIP 및 Service 8080 → `http` → containerPort 8080 연결
- DB 환경 변수 3개의 `menu-service-db` Secret 이름과 동일 이름 키 참조
- Readiness/Liveness의 TCP `http` 포트 검사
- 지정 GHCR 경로와 배포 전 실제 게시된 SHA 태그, `latest` 및 플레이스홀더 없음

2026-11-19 리뷰 수정 검증에서는 저장소 밖에 준비한 공식 Kustomize v5.8.3
Windows 실행 파일을 사용했습니다. 공식 릴리스의 `checksums.txt`와 다운로드한
압축 파일의 SHA-256 일치를 확인했으며, 프로젝트 의존성은 변경하지 않았습니다.

- 실제 Base/dev/prod 렌더링 3건 성공: Deployment·Service 각 1개,
  namespace `peakorder`, CI와 동일한 `/menu` 이미지 이름 확인
- 저장소 밖 YAML 검증 사본에서 dev/prod의 `newTag`만 서로 다른 시험용
  `sha-<40자리>`로 바꾼 렌더링 2건 성공: Base 이미지 태그 치환 확인
- 시험용 SHA는 게시 이미지가 아니며 저장소의 플레이스홀더를 대체하지 않음
- `git diff --check` 통과

Kustomize 렌더링은 Kubernetes API 서버의 스키마 검증이나 실제 배포를
대체하지 않습니다. 이미지 존재 여부·기동, DB 연결·Flyway, TCP Probe 응답,
Service 통신 및 실제 dev/prod 배포는 미검증입니다.

## 후속 연동

PR #76·#79·#82는 병합됐지만 해당 사실만으로 실배포 검증이 완료되지는 않습니다.
실제 배포 전 게시 이미지, 환경별 DB 및 Secret,
Namespace·이미지 접근 권한, 기동 시간 검증이 필요합니다.
공개 HTTPRoute는 아래 #275 구성에 포함합니다. TLS와 Argo CD Application 운영은 별도 작업입니다.
배포 경로는 **Git PR → Argo CD**이며 이 작업에서는 클러스터에 접근하지 않습니다.

Kubernetes 변경은 `CLAUDE.md` 6절의 필수 리뷰 대상입니다.
후속 PR 제출 시 GitHub Actions 결과 확인과 작성자 외 팀원 1명 승인이 필요합니다.
이 작업은 `deploy/apps/menu-service/`만 수정하며 서비스 소스·CI·Dockerfile,
다른 서비스 배포 구성 및 실제 Secret을 변경하거나 생성하지 않습니다.

## 자동 확장(HPA, dev) — Issue #367

- `overlays/dev/hpa.yaml`의 HorizontalPodAutoscaler가 CPU 사용률 평균 70%(requests 100m 기준 약 70m)를 목표로 Pod를 1개에서 3개까지 조절한다(#186 합의값). prod에는 없다.
- Pod 수는 HPA가 정하고, Application의 `ignoreDifferences`(`/spec/replicas`)와 `RespectIgnoreDifferences`가 Sync가 Git의 `replicas: 1`로 되돌리지 않게 한다. Git의 `replicas: 1`은 HPA가 없을 때의 값이다.
- 축소는 쿠버네티스 기본 안정화(5분)를 따른다. 줄어드는 Pod는 `preStop`(10초)과 `terminationGracePeriodSeconds`(50초)로 요청을 보호한다(#354).
- 확대하면 Pod당 DB 연결이 최대 4개라 서비스당 최대 12개(3 × 4)이고 전체 예산은 `max_connections` 상향(#186, 남규리) 뒤의 값을 따른다. 여러 서비스를 동시에 롤링하지 않는다.
- 확인: `kubectl -n peakorder get hpa menu-service`로 현재 사용률(TARGETS)과 Pod 수를 본다. 사용률이 `<unknown>`이면 CPU 지표(metrics-server) 문제다. 2 Pod 시험·부하 시험 결과는 담당 이슈 댓글에 있다.

## 공개 HTTPRoute (#275)

`base/httproute.yaml`은 `envoy-gateway-system/peakorder-gateway`의 `http`
리스너에 연결하며, backend는 같은 namespace의 `menu-service:8080`입니다.
base를 사용하는 dev/prod 렌더링에 모두 포함됩니다. 이미지·Deployment·Service는
변경하지 않으며 실제 prod 적용은 수행하지 않습니다.

| 메서드 | 경로 | 매칭 |
| --- | --- | --- |
| GET | `/api/v1/menus` | Exact (ME-01) |
| GET | `/api/v1/menus/{menuId}` | RegularExpression `^/api/v1/menus/[^/]+$` (ME-02) |

상세는 비어 있지 않은 한 세그먼트만 허용합니다. 숫자로만 제한하지 않아
`0`, `-1`, `abc`, `1.5`, Long 범위 초과 ID도 서비스에 도달하여
[기존 JSON 400 계약](../../../docs/api/menu-me01-me02.md)을 유지합니다.
쿼리 조건을 Route에 넣거나 경로를 rewrite하지 않습니다. 추가 하위 경로·후행 슬래시,
GET 외 메서드(HEAD 포함), 관리자·내부·Actuator·Swagger 경로는 이 Route에서 연결하지 않습니다.

RegularExpression은 구현체별 지원 기능입니다.
[Envoy Gateway v1.5.0 공식 구현](https://github.com/envoyproxy/gateway/blob/v1.5.0/internal/gatewayapi/route.go)은
`PathMatchRegularExpression`을 검증해 `SafeRegex`로 전달합니다. 이는 제품 지원 근거이며
현재 dev/prod 설치 버전 확인 결과가 아닙니다. 로컬에 kubectl 및 kubeconfig가 없어
설치 이미지·CRD 지원 범위는 **미검증**입니다. Gateway 담당자가 실제 설치 버전과
정규식 지원을 확인하고 dev server dry-run 및 `Accepted=True`·`ResolvedRefs=True`를
검증해야 합니다. 지원하지 않으면 넓은 PathPrefix로 대체하지 말고 별도 협의합니다.

Auth #155·Cooking PR #266 선례 및
[#112 확정 기록](https://github.com/ktcloud-cloudnative-2026/team02-5xx/issues/112#issuecomment-7094381845)에
따라 `X-User-Id`·`X-User-Role`을 제거합니다. 공개 조회에 JWT는 요구하지 않습니다.
현재 main의 Auth `/api/v1/auth` 및 미병합 #266의 Cooking 공개 경로와 겹치지 않습니다.

로컬 검증: Kustomize v5.8.3으로 두 서비스 base/dev/prod 총 6건 렌더링,
변경 전후 기존 리소스의 YAML 객체 동일성, parentRef/backend/method/path/라벨,
허용·차단 경로와 `git diff --check`를 확인했습니다.
실제 Gateway JSON 응답·검색 쿼리·잘못된 ID의 400·미존재/HIDDEN의 404,
위조/중복/대소문자 변형 헤더 제거, 다른 서비스의 실환경 회귀는 미검증입니다.
server dry-run·실제 배포·Argo CD Sync는 실행하지 않았습니다.
Gateway 담당자 리뷰 승인과 CI 성공 후 Git PR → Argo CD 절차로 후속 검증합니다.
