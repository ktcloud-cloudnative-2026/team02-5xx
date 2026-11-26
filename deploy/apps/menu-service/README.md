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
    dev/hikari-patch.yaml
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
- 환경별 복제 수, 실제 DB 주소 및 추가 인프라 정책은 별도 확인 대상입니다.
  자원 제한·JVM·종료 보호와 dev Hikari 설정은 아래 #354에 따릅니다.

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

Base와 prod Overlay는 아래 **미배포 플레이스홀더**를 유지합니다.
dev는 `sha-eac2e88c7da2ed894689d4868713467c975ee3f4`를 사용하며, #354에서
이미지 태그를 갱신하지 않습니다. 플레이스홀더는 배포 가능 여부를 나타내지 않습니다.

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


## 자원·연결 풀·정상 종료 보호 (#354)

기준 main `8c319af4abe5550ead0bf765b06e67a80dec85ac`, 작업 브랜치
`infra/354-menu-resource-readiness`. #280의 미커밋 검토 문서를 보존하기 위해
기존 경로를 유지하고 이 작업만 별도 worktree에서 수행했다.

| 항목 | 변경 전 | 변경 후 | 적용 범위 |
| --- | --- | --- | --- |
| CPU requests / limits | 미지정 | `100m` / `1` | base → dev·prod 렌더링 |
| 메모리 requests / limits | 미지정 | `384Mi` / `768Mi` | base → dev·prod 렌더링 |
| `JAVA_TOOL_OPTIONS` | 미지정 | `-XX:MaxRAMPercentage=60.0` | base → dev·prod 렌더링 |
| Hikari 최대 / 최소 유휴 | 명시값 없음(기본 최대 10) | `4` / `1` | **dev overlay만** |
| `preStop` | 없음 | `["sh", "-c", "sleep 10"]` | base → dev·prod 렌더링 |
| `terminationGracePeriodSeconds` | 미지정(Kubernetes 기본 30초) | `50` | base → dev·prod 렌더링 |

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

이번에는 Commit·Push·PR 생성·병합·배포·클러스터 접근을 하지 않았다.
후속 제출·배포 시 서비스 및 공통 인프라 담당의 필수 리뷰와 CI, DB 담당 확인이 필요하다.

1. 다른 서비스 배포 PR과 동시에 병합하지 않고, Argo CD 자동 Sync·Healthy 및
   rollout 완료를 확인한다. 현재 자동 Sync 여부는 이 작업에서 현장 조회하지 않았다.
2. 실제 Pod에서 resources·JVM 옵션·Hikari 4/1 바인딩과 menu_dev 연결 수를 확인한다.
   최소 유휴 1은 전체 연결 수의 고정값이 아니며 사용 중에는 Pod당 최대 4개다.
3. 고객·내부 API 응답, 관리자 차단 유지, 롤링 중 오류·재시작·OOM·DB 연결 대기와
   preStop/정상 종료 시각을 기록한다. 기존 TCP probe는 DB 준비 완료를 보장하지 않는다.
4. [#186의 최신 DB 예산 조건](https://github.com/ktcloud-cloudnative-2026/team02-5xx/issues/186#issuecomment-7153706150)에
   따라 종료 중 Pod와 롤링 추가 Pod를 포함하고 Menu·Payment 풀 적용 전에는
   여러 서비스 동시 롤링을 피한다. 2 Pod·HPA·prod 예산은 후속 담당 작업이다.
