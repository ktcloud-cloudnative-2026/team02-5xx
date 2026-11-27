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
초기 구성 당시 기록입니다. dev 실환경 검증 및 현재 prod 최초 배포 준비 상태는 아래 #450 절을 따릅니다.

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
    dev/hikari-patch.yaml
    dev/admin-enabled-patch.yaml
    dev/probes-patch.yaml
    dev/admin-httproute.yaml
    dev/admin-securitypolicy.yaml
    prod/kustomization.yaml
    prod/hikari-patch.yaml
    prod/probes-patch.yaml
    prod/admin-enabled-patch.yaml
    prod/admin-httproute.yaml
    prod/admin-securitypolicy.yaml
```

- Deployment와 ClusterIP Service의 이름은 `menu-service`입니다.
- Namespace는 `peakorder`, 두 리소스와 Pod의 공통 라벨은
  `app: menu-service`, `team: team02`입니다.
- Deployment 및 Service selector는 Pod의 `app: menu-service`와 일치합니다.
- Service TCP 8080 → 이름 `http` → 컨테이너 TCP 8080으로 연결됩니다.
  Spring Boot 기본 포트를 사용하며 이미지의 실행 명령을 재정의하지 않습니다.
- Base에 공통 리소스를 두고 dev/prod Overlay에서 각각 이미지 태그를 지정합니다.
  dev/prod는 독립 클러스터이므로 이름이나 namespace 접미사를 추가하지 않습니다.
- 환경별 복제 수, 실제 DB 주소 및 추가 인프라 정책은 별도 확인 대상입니다.
  자원 제한·JVM·종료 보호와 dev Hikari 설정은 아래 #354에 따릅니다.

## PostgreSQL Secret 선행 조건

각 dev/prod 클러스터의 `peakorder` namespace에 `menu-service-db` Secret을
별도로 준비해야 합니다. 다음은 이 배포 구성에서 사용하는 이름·키 계약이며,
기존 Secret이 이미 존재한다는 뜻은 아닙니다.

| 컨테이너 환경 변수 | Secret 이름       | Secret 키          | 용도                     |
| ------------------ | ----------------- | ------------------ | ------------------------ |
| `MENU_DB_URL`      | `menu-service-db` | `MENU_DB_URL`      | Menu PostgreSQL JDBC URL |
| `MENU_DB_USERNAME` | `menu-service-db` | `MENU_DB_USERNAME` | Menu DB 사용자           |
| `MENU_DB_PASSWORD` | `menu-service-db` | `MENU_DB_PASSWORD` | Menu DB 비밀번호         |

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

#365에서 Actuator가 추가됐고 #394의 dev 이미지에 포함됐다. #402는 dev overlay에 먼저
아래 HTTP Probe를 적용했고 #450은 검증된 설정을 prod에 승격한다. `port: http`는 컨테이너 8080을 가리킨다.

| Probe | 경로 | 주기 | 실패 임계값 |
| --- | --- | --- | --- |
| startup | `/actuator/health/liveness` | 5초 | 24회 |
| readiness | `/actuator/health/readiness` | 10초 | 기본값 3회 |
| liveness | `/actuator/health/liveness` | 20초 | 기본값 3회 |

Auth·Order와 같은 값이다. startup 성공 전에는 readiness/liveness 검사를 시작하지 않는다.
startup은 약 120초의 기동 검사 예산이며 실제 dev 기동·롤링 검증은 별도다.
명시하지 않은 timeoutSeconds(1초), successThreshold(1회) 등은 Kubernetes 기본값을 쓴다.
readiness/liveness는 `$patch: replace`로 교체해 base의 `tcpSocket`이 함께 남지 않게 한다.

base는 기존 TCP Probe를 유지한다. #450부터 prod는 dev와 같은 HTTP Probe를 사용한다. TCP 연결 성공은 포트 개방만 확인한다.
**현재 기본 HTTP readiness도 DB 준비 완료를 보장하지 않는다.** #365의 격리 DB 장애 시험에서
전체 health는 503 DOWN이었지만 readiness/liveness는 200 UP이었다.
DB를 liveness에 넣거나 readiness health group을 변경하지 않았다.
이번 게시 이미지·로컬 HTTP·렌더링 검증 및 후속 절차는
[별도 검증 기록](../../../docs/menu-http-probes-validation-402.md)에 있다.

## GHCR 이미지 태그 교체

Base는 아래 **미배포 플레이스홀더**를 유지합니다.
#450의 prod 후보는 #394에서 적용하고 #402 및 #409에서 실제 dev 검증한
`sha-46d1801215997aa767ab12fa53249acd06b710d1`입니다. dev 태그 갱신은 별도 PR로 관리합니다.

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

- base Deployment·Service·HTTPRoute 각 1개, dev는 관리자 Route/Policy 및 HPA 추가,
  prod는 관리자 Route/Policy 추가(총 5개), namespace `peakorder`
- 리소스 및 Pod의 공통 라벨과 selector 일치
- ClusterIP 및 Service 8080 → `http` → containerPort 8080 연결
- DB 환경 변수 3개의 `menu-service-db` Secret 이름과 동일 이름 키 참조
- base의 TCP Readiness/Liveness 유지, dev/prod의 세 HTTP Probe와 단일 handler 확인
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

## Pod 수 관리(HPA 준비) — Issue #367

- Argo CD Application(`deploy/argocd/dev/menu-service.yaml`)은 Deployment의 `/spec/replicas`를 비교에서 제외하고 `RespectIgnoreDifferences=true`로 Sync가 그 값을 되돌리지 않게 한다(Order #204와 같은 방식, 자동 동기화 설정은 그대로). 이후 HPA가 Pod 수를 정하거나 2 Pod 시험을 위해 수동으로 늘려도 Sync가 Git의 `replicas: 1`로 되돌리지 않는다.
- 이 파일은 Argo CD가 관리하지 않아, 바꾸면 dev에서 `kubectl apply -f deploy/argocd/dev/menu-service.yaml`로 다시 적용해야 반영된다.

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
- 확인: `kubectl -n peakorder get hpa menu-service`로 현재 사용률(TARGETS)과 Pod 수를 본다. 사용률이 `<unknown>`이면 CPU 지표를 아직 읽지 못한 것이다. 원인은 Pod의 CPU requests 미설정, Pod가 아직 Ready가 아니거나 기동 직후 지표 수집 지연, metrics-server 이상 등일 수 있으므로 `kubectl -n peakorder describe hpa menu-service`의 Conditions·Events와 `kubectl -n peakorder top pod`로 원인을 좁힌다. 2 Pod 시험·부하 시험 결과는 담당 이슈 댓글에 있다.

## 공개 HTTPRoute (#275)

`base/httproute.yaml`은 `envoy-gateway-system/peakorder-gateway`의 `http`
리스너에 연결하며, backend는 같은 namespace의 `menu-service:8080`입니다.
base를 사용하는 dev/prod 렌더링에 모두 포함됩니다. 이미지·Deployment·Service는
변경하지 않으며 실제 prod 적용은 수행하지 않습니다.

| 메서드 | 경로                     | 매칭                                              |
| ------ | ------------------------ | ------------------------------------------------- |
| GET    | `/api/v1/menus`          | Exact (ME-01)                                     |
| GET    | `/api/v1/menus/{menuId}` | RegularExpression `^/api/v1/menus/[^/]+$` (ME-02) |

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

## dev 관리자 API 연동 (#280)

`overlays/dev/`에 `admin-httproute.yaml`, `admin-securitypolicy.yaml`,
`admin-enabled-patch.yaml`을 추가했다. ME-03~07 GET·POST·PATCH의 정확한 경로만
별도 Route로 공개하며 Order dev와 같은 JWT provider를 사용한다.
JWT Route에는 헤더 remove를 넣지 않고, 기존 공개 Route의 remove는 유지한다.
#280 당시 base/prod는 `MENU_ADMIN_ENABLED=false`이며 관리자 Route/Policy를 포함하지 않았다.
#450에서 prod를 별도 활성화하며 base는 계속 기본 차단이다.
Service·포트·Secret·probe·이미지 태그·NetworkPolicy와 내부 호출 관계는 유지한다.
#280 자체는 자원·Hikari·종료 보호를 추가하지 않았다. 현재 통합 결과는 병합된 #357의
자원·JVM·dev Hikari 4/1·종료 보호를 함께 보존한다. Menu HPA·모니터링은 추가하지 않는다.

`MENU_ADMIN_ENABLED=true`는 Gateway 경유를 증명하지 않는다. 기존 #112/#280의
Gateway JWT + NetworkPolicy + 서비스 신원/역할 검사와 운영 통제를 전제로 하는 활성화다.
허용된 내부 Pod·노드 수준의 우회 위험은 남는다.

### 적용 전 필수 게이트

**새 관리자 코드가 포함된 이미지를 Gateway 보호 검증 전에 활성화하지 않는다.**
Kustomize의 파일 순서나 단순 sync-wave로 JWT Policy의 실제 준비 완료를 보장할 수 없다.
현재 main 태그의 게시 JAR에는 관리자 컨트롤러/활성화 설정이 없어 true 환경 변수에도
관리자 API를 제공하지 않는다. main 소스의 상시 false/403과 구 이미지의 엔드포인트 부재는 구분한다.
GitOps 담당이 이 구 이미지 차단을 확인한 단계 적용 또는
명시적 토글 false/자동 Sync 조율을 사용하여 Route/Policy·NetworkPolicy·운영 통제를 먼저 확인한다.
그 이후에만 승인된 새 이미지·활성화를 반영한다. 구 이미지가 바뀌면 차단 전제를 재확인한다.
이 작업에서 실제 클러스터나 Application을 변경하지 않았다.

롤백은 **토글 false → 서비스 차단 확인 → 관리자 Route 비공개/Policy 정리** 순서다.
활성 서비스·공개 Route를 남긴 채 Policy만 제거하지 않는다.
세부 시험 목록과 실패 시 절차는
[최신 Menu 인증 연동 문서](../../../docs/api/menu-admin-auth-integration.md)를 따른다.

## 자원·연결 풀·정상 종료 보호 (#354, 병합 PR #357)

기준 main `8c319af4abe5550ead0bf765b06e67a80dec85ac`, 작업 브랜치
`infra/354-menu-resource-readiness`. #280의 미커밋 검토 문서를 보존하기 위해
기존 경로를 유지하고 이 작업만 별도 worktree에서 수행했다.

| 항목                            | 변경 전                      | 변경 후                     | 적용 범위              |
| ------------------------------- | ---------------------------- | --------------------------- | ---------------------- |
| CPU requests / limits           | 미지정                       | `100m` / `1`                | base → dev·prod 렌더링 |
| 메모리 requests / limits        | 미지정                       | `384Mi` / `768Mi`           | base → dev·prod 렌더링 |
| `JAVA_TOOL_OPTIONS`             | 미지정                       | `-XX:MaxRAMPercentage=60.0` | base → dev·prod 렌더링 |
| Hikari 최대 / 최소 유휴         | 명시값 없음(기본 최대 10)    | `4` / `1`                   | **dev overlay만**      |
| `preStop`                       | 없음                         | `["sh", "-c", "sleep 10"]`  | base → dev·prod 렌더링 |
| `terminationGracePeriodSeconds` | 미지정(Kubernetes 기본 30초) | `50`                        | base → dev·prod 렌더링 |

### 범위 판단

자원·JVM·종료 보호는 기존 Order·Inventory·Auth와 같은 base 구조를 사용한다.
반면 Hikari 4/1은 [#354](https://github.com/ktcloud-cloudnative-2026/team02-5xx/issues/354)의
**dev 기준**과 [#186 DB 합의](https://github.com/ktcloud-cloudnative-2026/team02-5xx/issues/186#issuecomment-7095046477)에
따라 `overlays/dev/hikari-patch.yaml`로 한정했다. Order의 dev Hikari 패치와
Auth의 dev session 패치가 같은 선례다. Inventory/Cooking의 base 풀 설정을
그대로 복사해 prod에 확대하지 않았다. dev·prod가 같은 DB 서버를 쓰므로
prod 연결 예산은 별도 검토한다.

기존 Secret 참조 3개, TCP readiness/liveness probe, dev/prod 이미지 태그,
Service·HTTPRoute와 관리자 차단 정책은 유지한다. HPA·replicas 비교 제외,
Actuator·Prometheus·startupProbe 및 NetworkPolicy는 추가하지 않았다.
**base 변경은 prod 렌더링에도 반영되지만, prod 배포나 이미지 태그 변경을 뜻하지 않는다.**
prod의 기존 미배포 이미지 플레이스홀더와 Hikari 미지정 상태도 그대로다.

### 실제 게시 이미지 확인

소스 Dockerfile만으로 판단하지 않고, 현재 dev overlay의 다음 게시 이미지를
GHCR에서 내려받아 linux/amd64 manifest·config·각 layer digest를 확인했다.

```text
ghcr.io/ktcloud-cloudnative-2026/team02-5xx/menu:sha-eac2e88c7da2ed894689d4868713467c975ee3f4
linux/amd64 manifest sha256:b17ebd251d5fa3dff8c534baab3458478b4508e3382883dd090e5062b602922f
```

- 실제 이미지 설정: `USER app`(UID 100), `WORKDIR /app`, exec형
  `ENTRYPOINT ["java", "-jar", "app.jar"]`. Deployment가 실행 명령을 덮어쓰지 않는다.
- 이미지에 `/bin/sh`, `/bin/sleep`이 있고 app 사용자로 실행할 수 있음을 확인했다.
- Docker 실행기가 없어 WSL2의 별도 mount/PID namespace와 chroot에서
  **내려받은 이미지의 JRE·app.jar 그대로** 실행했다. JVM은 namespace PID 1,
  UID 100이며 SIGTERM을 직접 받았다. 셸은 `exec java`로 교체해 exec형 ENTRYPOINT와
  동일한 신호 전달 구조를 유지했다. 이미지나 서비스 코드를 덧붙이지 않았다.
- 실제 JRE는 Temurin 21.0.13.1, app.jar의 Spring Boot는 4.1.2다.
  게시 JAR의 configuration metadata에서 `server.shutdown=graceful`,
  `spring.lifecycle.timeout-per-shutdown-phase=30s` 기본값을 직접 확인했다.
  따라서 중복 환경 변수를 추가하지 않는다.
- 별도 loopback PostgreSQL 16에서 앱 기동·Flyway·메뉴 조회 200을 확인했다.
  제안한 dev 환경 변수 이름 그대로 Hikari `maximumPoolSize=4`, `minimumIdle=1`
  바인딩을 실제 이미지의 HikariConfig 로그에서 확인했다.
- 실제 `sh -c "sleep 10"` 실행 후에도 HTTP 요청이 처리됐다.
  DB 잠금으로 진행 중인 메뉴 조회를 유지한 상태에서 JVM PID 1에 SIGTERM을 보냈다.
  새 TCP 연결은 거부되고, 잠금을 해제한 기존 요청은 200으로 완료된 뒤
  `Graceful shutdown complete` 및 Hikari 종료를 확인했다. JVM 종료 코드 143은
  SIGTERM 종료이며, 로그·진행 중 응답 완료로 graceful 처리 여부를 별도 확인했다.

이것은 실제 이미지 파일시스템/JVM을 사용한 **로컬 Linux 실행 검증**이다.
Docker/OCI 런타임, 768Mi cgroup 제한, Kubernetes kubelet의 hook 실행과
Service/Gateway endpoint 전파, 실제 dev 롤링 시험을 대체하지 않는다.

50초는 preStop 10초 + Boot의 기본 종료 단계 30초 + 여유 10초라는 기존 서비스
기준이다. 30초는 각 종료 단계의 기본값이지 모든 종료 단계 합계의 상한이 아니다.
느린 요청·연결·추가 lifecycle 단계가 예산을 넘으면 kubelet이 강제 종료할 수 있으므로
실제 dev에서 종료 시간과 응답 유실을 확인해야 한다.

### 이번 검증 결과 (2026-11-25)

```powershell
kustomize build deploy/apps/menu-service/overlays/dev
kustomize build deploy/apps/menu-service/overlays/prod
# 별도 폐기 가능한 PostgreSQL 테스트 DB 환경 변수를 지정한 Menu 디렉터리에서
.\gradlew.bat --no-daemon spotlessCheck test build --rerun-tasks --console=plain
git diff --check
```

- Kustomize **v5.8.3**으로 변경 전후 dev/prod 4개 렌더링 PASS.
  각 환경의 리소스 3개 유지, 환경 변수 이름 중복 없음, 자원·JVM·종료·dev 풀 값 확인.
  새 설정을 제외한 Deployment 객체와 기존 Service·HTTPRoute 객체가 변경 전과
  동일함을 비교했다. Secret 참조·probe·태그·selector·포트·replicas도 보존했다.
- 기존 Menu 테스트 **534 PASS, 실패/오류/생략 0**, 실제 별도 PostgreSQL 18 테스트
  **91건 포함**. 고객 ME-01·02·내부 MI-01·02와 관리자 기본 차단 회귀를 포함한다.
  Gradle `test`, `spotlessCheck`, `build` PASS. 테스트 조건을 완화하지 않았다.
- 게시 이미지의 sh/sleep, PID 1 SIGTERM, Hikari 4/1, 진행 요청 완료 시험 PASS.
- 저장소 밖 `C:/M/Peak_Order-354-qa/`에 before/after YAML, `validation.json`,
  `runtime-results.json`, `image-runtime.log`, `gradle.log`를 보관했다.
  실험 과정의 초기 검증 도구 오류는 수정 후 재실행했으며 최종 결과와 구분한다.
- 이번 검증 전용 PostgreSQL만 종료하며 다른 worktree·미리보기 프로세스를 유지한다.

### dev 반영 후 확인할 것

위 2026-11-25 기록은 #354의 최초 로컬 검증이다. 이후 PR #357은 main `ca7c82b`로 병합됐다.
현재 #360 통합 작업은 이 설정을 보존하며 Commit·Push·PR 병합·배포·클러스터 접근을 하지 않는다.
후속 #360 제출·배포 시 서비스 및 공통 인프라 담당 리뷰와 CI, DB 담당 확인이 필요하다.

1. 다른 서비스 배포 PR과 동시에 병합하지 않고, Argo CD 자동 Sync·Healthy 및
   rollout 완료를 확인한다. 현재 자동 Sync 여부는 이 작업에서 현장 조회하지 않았다.
2. 실제 Pod에서 resources·JVM 옵션·Hikari 4/1 바인딩과 menu_dev 연결 수를 확인한다.
   최소 유휴 1은 전체 연결 수의 고정값이 아니며 사용 중에는 Pod당 최대 4개다.
3. 고객·내부 API 응답, 관리자 차단 유지, 롤링 중 오류·재시작·OOM·DB 연결 대기와
   preStop/정상 종료 시각을 기록한다. 기존 TCP probe는 DB 준비 완료를 보장하지 않는다.
4. [#186의 최신 DB 예산 조건](https://github.com/ktcloud-cloudnative-2026/team02-5xx/issues/186#issuecomment-7153706150)에
   따라 종료 중 Pod와 롤링 추가 Pod를 포함하고 Menu·Payment 풀 적용 전에는
   여러 서비스 동시 롤링을 피한다. 2 Pod·HPA·prod 예산은 후속 담당 작업이다.

## prod 연결 풀 초기 설정 — Issue #416 (2026-11-26)

기준 main은 `d4e2212ac053cb257eea1b22f0e5c285463ed909`, 작업 브랜치는
`infra/416-menu-prod-hikari`다. 위 #354/#357의 prod Hikari 미지정 기록은
당시 이력으로 보존하며, 이번 변경부터 prod에도 아래 값을 명시한다.
병합된 #357의 자원·종료 보호와 #388의 dev HPA를 기준으로 하며,
미병합 #402/PR #407의 HTTP Probe 변경은 포함하지 않는다.

`overlays/prod/hikari-patch.yaml`을 prod kustomization의 `patches`에 연결한다.
대상은 `apps/v1` Deployment `peakorder/menu-service`의 `menu-service` 컨테이너다.
dev와 같은 구조·값을 쓰되 prod 파일로 독립 관리하고 dev 패치를 참조하지 않는다.

| 환경 변수 | prod 값 |
| --- | --- |
| `SPRING_DATASOURCE_HIKARI_MAXIMUM_POOL_SIZE` | `"4"` |
| `SPRING_DATASOURCE_HIKARI_MINIMUM_IDLE` | `"1"` |

### 근거와 공유 DB 연결 예산

[#186 DB 담당 11/25 제안](https://github.com/ktcloud-cloudnative-2026/team02-5xx/issues/186#issuecomment-7157471963)은
prod 초기 1 Pod·풀 4를 포함해 max_connections 150을 제안했고,
[11/26 적용 기록](https://github.com/ktcloud-cloudnative-2026/team02-5xx/issues/186#issuecomment-7178950709)과
[PostgreSQL 런북](../../../docs/runbook.md#postgresql-t2-db)에 100 → 150 적용이 기록돼 있다.
이는 담당자의 실행 기록을 확인한 것이며 이번 작업에서 DB에 접속해 재측정하지 않았다.
dev와 prod는 같은 PostgreSQL VM을 사용하고 서비스별 DB만 분리한다.

| 계산 조건 | 최대 연결 수 |
| --- | --- |
| 일반 연결 가능: max_connections 150 − 관리자 예약 3 | 147 |
| dev 최대 확장: 6서비스 × 3 Pod × 풀 4 | 72 |
| dev 동시 롤링: 6서비스 × (3 + surge 1) Pod × 풀 4 | 96 |
| dev 종료 중 Pod 중첩 포함 보수적 계산: 6 × (3 + 1 + 종료 중 1) × 4 | 120 |
| prod 초기: 6서비스 × 1 Pod × 풀 4 | 24 |
| 보수적 합계: dev 120 + prod 24 | 144 |

147 − 144 = 3은 **prod 롤링, 추가 DB 연결 및 HPA 확대를 보장하는 여유가 아니다**.
120도 종료 중 Pod를 서비스당 1개로 가정한 계산이며 반복 롤링 등의 절대 상한이 아니다.
다른 서비스도 풀 4를 적용하고 prod는 각 1 Pod라는 전제가 필요하다.
최소 유휴 1은 최대 연결 수를 줄이지 않는다. 여러 서비스의 동시 롤링 제한을 유지하고,
prod 롤링의 surge·종료 중 연결, 관리·마이그레이션·수동 접속 등 추가 연결과
확장 계획은 DB 담당과 별도로 예산을 재검토해야 한다. 이번 변경은 replicas/HPA를 정하지 않는다.

### 로컬 검증 결과

Kustomize v5.8.3으로 **변경 전후 base/dev/prod 총 6개 렌더링**을 실행했다.
실행 파일은 기존 저장소 밖 `C:/M/Peak_Order-354-qa/tools/kustomize.exe`이며
프로젝트 의존성은 추가하지 않았다. 저장소 루트에서 각 명령을 변경 전후 실행했다.

```powershell
& C:/M/Peak_Order-354-qa/tools/kustomize.exe build deploy/apps/menu-service/base
& C:/M/Peak_Order-354-qa/tools/kustomize.exe build deploy/apps/menu-service/overlays/dev
& C:/M/Peak_Order-354-qa/tools/kustomize.exe build deploy/apps/menu-service/overlays/prod
python C:/M/Peak_Order-416-qa/validate.py
git diff --check
```

- PASS: base 3개·dev 6개 객체 전체 동일. prod 3개 객체는 지정 env 두 개만 추가되고,
  그 두 항목을 제외한 전체 YAML 객체가 동일하다. Deployment/컨테이너 대상 및 env 중복 없음 확인.
- PASS: Menu YAML 전체를 중복 키 거부 로더(PyYAML)로 파싱했다.
  Secret 참조, 이미지 태그/prod placeholder, TCP Probe, Service·HTTPRoute,
  prod 관리자 false 및 관리자 Route/Policy 부재, CPU·메모리·JVM·ECS,
  preStop·종료 유예, replicas/HPA 정책을 보존했다.
- PASS: 변경 범위는 이 README와 prod patch·kustomization 3파일, `git diff --check` 통과.
  기존 미추적 15개 파일의 SHA-256 보존 확인. 검증 스크립트의 Windows 경로 처리 오류는
  수정 후 재실행했으며 최종 결과와 구분한다.
- before/after YAML 6개, 검증 스크립트·`validation.json`과 보존 확인 기록은
  저장소 밖 `C:/M/Peak_Order-416-qa/`에 보관했다.
- 과거 #354 등의 테스트 수치는 해당 시점의 기록으로만 보존한다. 이번 PASS로 재사용하지
  않았으며 Gradle/API/실행 시험은 재실행하지 않았다. 서비스 소스 변경은 없다.

Kustomize/YAML 검증은 API 서버 스키마 검증이나 실행 검증을 대체하지 않는다.
실제 prod 배포, DB 접속, Hikari 바인딩·연결 풀 실측, 이미지 기동·Flyway,
Argo CD Sync/Healthy, 롤링 및 고객·내부·관리자 API 실환경 회귀는 **미검증**이다.

### 배포 전 선행 조건과 후속 확인

1. 작성자 외 인프라/DB 담당의 필수 리뷰와 CI 통과 후 별도 배포 이슈에서 진행한다.
   배포 경로는 **Git PR → Argo CD**이며 prod 직접 apply를 하지 않는다.
2. DB 담당이 max_connections/예약 연결·현재 연결 수·메모리와 dev/prod 전체 풀·Pod 수,
   롤링/종료 중 중첩 및 추가 접속 예산을 재확인하고 배포 순서를 조율한다.
3. prod DB·접속 권한과 `menu-service-db`의 `MENU_DB_URL`·`MENU_DB_USERNAME`·
   `MENU_DB_PASSWORD` 키를 승인된 방식으로 준비한다. 비밀값을 출력하거나 Git에 넣지 않는다.
4. prod placeholder를 실제 게시·검증된 이미지 태그로 교체하는 별도 승인 변경과
   namespace·이미지 접근 권한·GitOps 등록/대상/동기화 정책 확인을 먼저 완료한다.
   이 작업에서는 이미지·Secret·Argo CD를 변경하지 않았다.
5. 승인된 배포 후 Pod Ready·재시작·OOM·연결 대기/시간 초과, 풀 최대 4·최소 유휴 1
   바인딩 및 실제 DB 연결 수를 확인한다. 고객·내부 조회, prod 관리자 차단,
   기존 Probe/Route와 종료 동작을 검증하고 배포 이슈에 결과를 남긴다.

### rollback

배포 전 취소는 prod kustomization의 `hikari-patch.yaml` 연결과 해당 파일만 제거하고
렌더링 비교 후 검토한다. 배포 후에도 승인된 Git PR → Argo CD로 복구하며,
이미지·Secret·기존 dev/base 설정을 함께 되돌리지 않는다.
**패치 제거는 이전 Hikari 미지정 상태(기본 최대 10)로 복귀할 수 있어 연결 예산을 늘린다.**
제거 전 실제 이미지의 기본/외부 설정과 전체 연결 예산을 DB 담당이 확인해야 하며,
예산을 충족하지 못하면 무조건 제거하지 말고 승인된 대체 풀 값과 배포 중지·복구 순서를 정한다.
롤백 자체의 Pod 교체·종료 중 연결도 포함한다. 복구 후 Argo CD/Pod 상태·풀 설정·DB 연결·
API 응답을 재확인한다. 공유 DB max_connections를 이번 rollback에서 변경하지 않는다.

## prod 최초 배포 설정 및 이미지 승격 — Issue #450 (2026-11-27)

기준 main `fb637c420372bf8982cf141113a586ed8616ea79`. prod overlay만 변경하며 #416 Hikari 4/1,
#354 CPU 100m/1, 메모리 384Mi/768Mi, JVM 60%, preStop 10초 및 종료 유예 50초,
ECS 로그, DB Secret 참조와 기존 공개 Route를 유지한다. prod는 1 Pod 기본값이며 HPA를 추가하지 않는다.
#407과 동일한 HTTP Probe 및 #280의 ME-03~07 관리자 Route/활성화 패치를 독립 prod 파일로 추가한다.

### 이미지와 JWT 계약

- prod 후보: `sha-46d1801215997aa767ab12fa53249acd06b710d1`.
- #402 종료 기록 및 #414 RUN-20261127-02~05의 실제 dev 이미지 digest:
  `sha256:de53bf04d895785dcdc2ad18d767af7658ca585b58acdb6922314b8ef46ab417`.
  #402에서 startup 초기 연결 거부 3회 후 회복, Pod Ready 21초, Sync/Healthy 54초,
  재시작/OOM 0, health 및 고객/관리자/내부 조회 검증을 보고했다.
- GitHub tree 비교에서 위 이미지 출처와 기준 main 사이 Menu 서비스 파일 차이는 #433 prod Seed SQL/README 2개뿐이다.
  #449의 새 dev 이미지 후보는 아직 실제 검증 완료를 확인하지 못해 승격하지 않는다.
  전체 통합 테스트 완료를 의미하지 않으며 Sync 직전에 게시 이미지·digest·관련 변경 및 검증 상태를 재확인한다.
- 실제 prod Auth 런타임 조회: issuer `https://peakorder.jpexstudio.com`, audience `peakorder-api-prod`.
  JWKS `http://auth-service.peakorder.svc.cluster.local:8080/api/v1/auth/jwks`.
  sub → X-User-Id, role → X-User-Role. 관리자 Route에는 remove를 넣지 않고 공개 Route의 remove는 유지한다.
- prod DB/Secret은 담당자가 생성 및 접속 확인을 보고했다. 실제 Menu 기동 및 권한은 미검증이다.

### 검증과 동기화 조건

1. 로컬 Kustomize로 base/dev/prod를 렌더링하여 base/dev 변경 없음, prod 5개 객체,
   태그·Probe 단일 handler·Route/Policy 연결·JWT 값·기존 설정 보존을 확인한다.
   이번 변경은 원격에서 작성하며 실제 렌더링 및 diff 검증은 사용자 실행 후 기록한다.
2. Gateway/GitOps 담당 리뷰·CI 통과 및 병합 이후에만 수동 Sync를 검토한다.
   prod 직접 apply 금지. NetworkPolicy Application의 Healthy 표시만으로 적용 성공을 판단하지 않는다.
   default-deny 및 allow-menu-service/allow-auth-service 실제 적용, Gateway/JWKS 접근,
   Menu Secret 키 존재, 이미지 pull 권한, DB 연결 예산, cp 메모리, 영업/주문 접수 닫힘을 확인한다.
3. 최초 배포 전 Gateway 담당과 선택 동기화 순서를 합의한다.
   기존 Menu Pod/Deployment가 없는 상태에서 Service와 공개/관리자 HTTPRoute 및 SecurityPolicy를 먼저 Sync한다.
   관리자 Route Accepted/ResolvedRefs, SecurityPolicy Accepted 및 무토큰/위조 헤더 요청 401을 확인한 뒤에만
   관리자 활성화 Deployment를 Sync한다. 정책 미수락·전파 미확인·보호 경계 검증 실패 시 Deployment Sync 중단.
   최초 Sync 이후 변경에도 인증 경계가 유지되도록 Gateway 담당과 조율한다.
4. Deployment Sync 후 실제 imageID, Pod Ready/재시작/OOM, 세 Probe, Flyway V1, Hikari 및 DB 연결을 확인한다.
   공개 조회, 관리자 무토큰 401/CUSTOMER 403/STORE_ADMIN 정상 조회, 위조 헤더 차단,
   내부 API·Actuator 외부 비노출을 검증한다. 기본 readiness는 DB 준비를 보장하지 않는다.
5. #433 승인 SQL의 실행 조건을 별도로 확인한 뒤 최초 메뉴 데이터를 등록하고 실제 메뉴 ID를 Inventory 담당에 인계한다.
   이번 변경은 DB 접속·Seed 실행·배포를 하지 않는다.

문제 발생 시 추가 Sync를 멈추고 Gateway 담당과 관리자 경로 비활성화/차단 및 승인된 Git PR 복구를 진행한다.
이전 prod placeholder로 무조건 되돌려 Sync하지 않는다. 실제 prod 검증은 미실시 상태다.
