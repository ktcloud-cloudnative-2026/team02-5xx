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
    httproute.yaml
    kustomization.yaml
  overlays/
    dev/kustomization.yaml
    dev/resources-patch.yaml
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
- dev/prod는 별도 클러스터에 같은 Base를 사용합니다. #366의 자원 초기값은
  dev의 `resources-patch.yaml`에만 지정하며 prod는 기존 구성을 유지합니다.
- 환경별 복제 수, 스케줄링 및 추가 보안 정책은 지정하지 않았습니다.
  자원 설정의 근거와 측정 한계는 아래 #366을 따릅니다.
  Namespace 생성과 이미지 접근 권한도 플랫폼 담당 범위입니다.

## 이미지 태그 교체

Base와 prod의 이미지 참조는 아래 **미배포 플레이스홀더**입니다.
현재 dev 태그는 #368로 main에 반영된 `sha-6219d6bf419ca733376c317fcbc4bbbd4d38ba5b`입니다.
아래 최초 자원 실측은 이전 dev 이미지 `sha-eac2e88c7da2ed894689d4868713467c975ee3f4`와
당시 main의 로컬 production 빌드를 대상으로 했습니다. 이전 실측의 이미지 SHA와 결과는 보존하며,
현재 게시 이미지의 확인 결과는 별도 구역에 기록합니다. #372 수정에서는 최신 main의 태그를 유지합니다.
Base/prod 플레이스홀더를 유지한 채 동기화하거나 배포하면 안 됩니다.

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

- Deployment·Service·HTTPRoute 각 1개, 모두 namespace `peakorder`
- 세 리소스 및 Pod의 공통 `app` / `team` 라벨
- Deployment와 Service selector가 Pod 라벨에 일치
- ClusterIP, Service 8080 → `http` → containerPort 8080 연결
- 두 Probe의 `/index.html`, `http` 포트
- 지정 GHCR 경로, 배포 전 실제 게시된 SHA 태그, `latest` 및 플레이스홀더 없음

초기 작성 시 렌더링은 미실행이었으나 #275에서 저장소 밖 Kustomize v5.8.3으로
base/dev/prod 렌더링과 기존 리소스 YAML 객체 동일성을 확인했습니다.
#366의 실제 dev 게시 이미지·로컬 격리 HTTP 및 자원 검증은 아래에 기록합니다.
Kubernetes 컨테이너 기동·Probe·Service 통신 및 dev/prod 배포는 미검증입니다.

## 후속 연동과 범위

공개 HTTPRoute는 아래 #275 구성에 포함합니다. TLS, Argo CD Application과 자동 동기화,
Namespace 및 인증정보 준비는 별도 작업입니다. 실제 배포 경로는
**Git PR → Argo CD**이며 이 작업에서는 클러스터에 접근하거나 배포하지 않습니다.
Dockerfile, 이미지 CI, React 소스, 다른 서비스 구성은 변경하지 않습니다.

Kubernetes 변경은 `CLAUDE.md` 6절의 필수 리뷰 대상입니다.
후속 PR 제출 시 GitHub Actions 결과 확인과 작성자 외 팀원 1명의 승인이 필요합니다.

## 공개 HTTPRoute (#275)

`base/httproute.yaml`은 `envoy-gateway-system/peakorder-gateway`의 `http`
리스너에 연결하며 backend는 `peakorder/web-frontend:8080`입니다.
dev/prod 모두 base를 상속하므로 Route가 렌더링되지만 실제 적용은 하지 않습니다.
이미지 태그·Deployment·Service·자동 Sync 정책은 변경하지 않습니다.

| 메서드    | 경로               | 매칭·근거                           |
| --------- | ------------------ | ----------------------------------- |
| GET, HEAD | `/`, `/index.html` | Exact, HTML 진입점                  |
| GET, HEAD | `/assets`          | PathPrefix, Vite 빌드 JS·CSS        |
| GET, HEAD | `/images`          | PathPrefix, public 이미지(SVG 포함) |

`src/App.jsx`는 `window.location.hash`를 사용하며 해시 부분은 HTTP 요청에
포함되지 않습니다. 따라서 `/menu`·`/cart` 같은 별도 SPA 경로는 열지 않습니다.
실제 `npm run build` 산출물은 `index.html`, `assets/index-*.js`,
`assets/index-*.css`, `images/defaults/menu-placeholder.svg` 등입니다.
favicon은 index.html의 data URI이므로 `/favicon.ico` 경로를 추가하지 않습니다.

Nginx의 `try_files $uri $uri/ /index.html` fallback을 고려해 `/` PathPrefix를
추가하지 않습니다. `/api/v1/unknown`, `/internal/v1/**`, `/actuator/**`,
Swagger 경로 및 다른 메서드는 Frontend로 전달되지 않습니다. PathPrefix는
세그먼트 경계 기준이므로 `/assets-other`·`/images-other`도 매칭되지 않습니다.
허용한 정적 경로 안의 미존재 파일은 기존 Nginx fallback 동작을 따릅니다.
공개 정적 요청에서도 #112 계약에 맞춰 `X-User-Id`·`X-User-Role`을 제거합니다.

로컬에서 실제 production 빌드를 저장소 밖에 생성하고 모든 산출물의 GET/HEAD
Route 매칭, 금지 경로 및 Auth/Cooking 경로와의 비충돌을 검사했습니다.
두 서비스 base/dev/prod 총 6건의 Kustomize 렌더링, 기존 리소스 불변,
Route 메타데이터·연결 정보 및 `git diff --check`를 확인했습니다.
실제 Gateway의 HTML·JS·CSS·SVG 상태/Content-Type, 브라우저 동일 Origin 메뉴 연동,
미등록 API의 비노출·헤더 제거 및 Accepted/ResolvedRefs 상태는 **미검증**입니다.
server dry-run·Argo CD Sync·dev/prod 배포는 실행하지 않았습니다.
Gateway 담당자 리뷰 승인과 CI 성공 후 실환경에서 후속 확인해야 합니다.

## dev 자원 초기값과 실측 (#366)

최초 실측일 2026-11-26, 당시 기준 main `6219d6bf419ca733376c317fcbc4bbbd4d38ba5b`,
작업 브랜치 `infra/366-web-frontend-resources`.
[#366](https://github.com/ktcloud-cloudnative-2026/team02-5xx/issues/366)과
[#186 Frontend 담당 합의](https://github.com/ktcloud-cloudnative-2026/team02-5xx/issues/186#issuecomment-7088327252),
[배포/자원 작업 분리 합의](https://github.com/ktcloud-cloudnative-2026/team02-5xx/issues/186#issuecomment-7092241300)를 따른다.
Frontend는 Spring 초기값을 복사하지 않고 별도 실측하며 HPA는 우선 제외한다.

### 적용 위치와 선택 이유

| 환경 | 자원 변경                             | 이유                                                 |
| ---- | ------------------------------------- | ---------------------------------------------------- |
| base | 없음                                  | prod까지 검증되지 않은 초기값이 전파되는 것을 피한다 |
| dev  | `resources-patch.yaml`로 아래 값 추가 | #186의 dev 우선 실측·조정 합의                       |
| prod | 없음                                  | dev 기동·부하·노드 여유 검증 후 별도 이슈/승인 필요  |

#366의 기본 구현 대상으로 검토한 `base/deployment.yaml`은 그대로 두었다.
실측이 로컬/단일 인스턴스에 한정되고 prod 트래픽 목표도 없으므로 공통 운영값으로 확정할 근거가 없다.
변경 파일은 이 README, dev kustomization 및 dev resources patch의 **3파일**이다.

| 설정            | dev 제안값 | 판단                                                                                              |
| --------------- | ---------- | ------------------------------------------------------------------------------------------------- |
| CPU requests    | `25m`      | 유휴/합성 대표 부하보다 여유를 둔 스케줄링 시작값. 최대 처리량 보장값이 아니다                    |
| 메모리 requests | `32Mi`     | 이번 기동/대표 부하보다 여유를 둔다. page cache·worker 수·실환경 부하에 따라 재검토               |
| CPU limits      | `250m`     | 가벼운 정적 요청에서 여유가 있고 포화 시 CPU를 제한한다. 처리량 상한·지연 증가는 아래 실측과 구분 |
| 메모리 limits   | `128Mi`    | 이번 관찰 peak보다 여유를 둔 초기 상한. 장시간·실제 노드의 OOM 안전성을 확정하지 않는다           |

검증 시작 후보를 유지한다. 실제 CPU 제한은 throttling으로 작동하고 메모리 초과 시 OOM이 발생할 수 있다.
requests는 스케줄링에 사용되며 사용량의 상한이 아니다.
[Kubernetes 자원 관리](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/).
자원 patch는 HPA/PDB/replicas·이미지·probe·Service/HTTPRoute·labels/selector·Nginx/React를 변경하지 않는다.

### 최초 실측의 이전 게시 이미지 및 격리 실행

```text
ghcr.io/ktcloud-cloudnative-2026/team02-5xx/web-frontend:sha-eac2e88c7da2ed894689d4868713467c975ee3f4
linux/amd64 manifest sha256:a5e8dfa7c63e0db2aa85699a6e6a42752e5af3ca592407ef0aba9b327cb34861
```

GHCR에서 manifest/config와 10개 layer를 내려받아 digest를 검증하고 실제 rootfs를 재구성했다.
config의 revision은 `eac2e88c7da2ed894689d4868713467c975ee3f4`다.
Nginx **1.30.6**, `USER nginx`(UID/GID **101**), 작업 디렉터리 `/`,
`ENTRYPOINT ["/docker-entrypoint.sh"]`, `CMD ["nginx", "-g", "daemon off;"]`,
종료 신호 SIGQUIT를 확인했다. Deployment는 실행 명령/환경 변수를 덮어쓰지 않는다.
실제 이미지의 `nginx.conf`는 저장소 `.github/ci/docker/nginx.conf`와 같은 내용이다.

- `worker_processes auto`, `worker_connections 1024`; 이번 4 vCPU 환경에서는 master 1 + worker 4개였다.
  quota를 250m로 낮춰도 worker는 4개였다. autotune 환경 변수는 미설정이므로
  entrypoint의 `30-tune-worker-processes.sh`는 설정을 바꾸지 않았다.
  [Nginx worker 설정](https://nginx.org/en/docs/ngx_core_module.html#worker_processes).
- 8080, `/usr/share/nginx/html`, `/tmp/nginx.pid`와 임시 디렉터리,
  `try_files $uri $uri/ /index.html`, stdout access log/stderr error log를 유지했다.
  gzip/sendfile 설정을 추가하지 않았다. 실행 전후 Nginx 설정 해시도 동일했다.
- 게시 이미지의 HTML 545B·JS 303,293B·CSS 26,450B·SVG 551B와
  당시 main(`6219d6b`)의 production 빌드는 서로 다른 산출물이다. 이 이전 게시 이미지에는 PNG/WebP가 없다.
  최신 빌드의 PNG/WebP까지 확인하기 위해 같은 게시 Nginx에 별도 빌드 파일을 읽기 전용으로 연결했다.
  이 추가 시험을 새 이미지 게시나 기존 이미지 내용의 검증으로 혼동하지 않는다.

호스트는 Windows 11/PowerShell 5.1, WSL2 Ubuntu 24.04,
Linux `6.18.58.1-microsoft-standard-WSL2`, 4 vCPU다.
Docker/OCI 실행기는 없어 **systemd RootDirectory + 전용 network/mount 격리 + cgroup v2**를 사용했다.
이미지의 entrypoint/Nginx 바이너리·라이브러리·정적 파일과 UID를 그대로 실행했다.
시험용 network namespace의 loopback 8080으로만 요청하여 공유 dev/기존 서버에 부하를 주지 않았다.
부하 생성기와 계측기는 Nginx cgroup 밖에서 실행했다.

| 시험                       | `cpu.max`      | `memory.max` | `memory.swap.max` |
| -------------------------- | -------------- | ------------ | ----------------- |
| 게시 이미지 무제한         | `max 100000`   | `max`        | `max`             |
| 게시 이미지/최신 빌드 제한 | `25000 100000` | `134217728`  | `0`               |

`CPUQuota=25%`, 100ms period, `MemoryMax=128Mi`를 설정한 후 커널 파일에서 위 값을 확인했다.
두 조건 모두 CPU controller 계측을 위해 CPUWeight=100을 사용했다.
**실제 cgroup CPU/메모리 상한은 적용했으나 Kubernetes requests의 스케줄링/경쟁 상황은 시험하지 않았다.**
swap 0도 이 로컬 시험 조건이며 실제 클러스터 swap 정책 확인은 별도다.
master는 systemd의 서비스 프로세스이며 OCI 컨테이너 PID 1 실행 시험은 아니다.

### 부하 방식과 측정 해석

각 실행은 기동부터 첫 `/index.html` 200까지 시간·누적 CPU와 memory peak를 기록했다.
이후 유휴 10초, 대표 20 req/s(동시 4), 증가 200 req/s(동시 16),
burst 1000 req/s(동시 32), 포화 closed-loop(동시 32)를 각각 15초 실행했다.
대표/증가 수치는 합성 시험 조건이며 실제 사용자 동시성·트래픽 목표로 합의된 값이 아니다.
HTML·JS·CSS·이미지 파일을 균등 순환하며 HTTP/1.1 keep-alive를 사용했다.
브라우저 캐시·TLS·Gateway·백엔드 API 호출/렌더링·느린 클라이언트는 포함하지 않았다.

최종 두 산출물 모두 WSL의 ext4에 두었다. 시스템 전체 cache를 비우거나 기존 프로세스를 중단하지 않았다.
따라서 cold image pull/완전히 cold한 디스크 기동 및 경쟁 부하의 결과가 아니다.
CPU는 cgroup `cpu.stat usage_usec` 차이/시간, 메모리는 `memory.current`/`memory.peak`를 사용했다.
약 20ms 간격으로 수집했고 anon/file도 분리했다. **프로세스 RSS를 컨테이너 메모리로 간주하지 않았다.**
stdout이 systemd journal 소켓일 때 이미지의 `/dev/stderr` 재열기가 실패하여,
검증용 출력 FD를 일반 로그 파일로 연결했다. Nginx 설정은 바꾸지 않았다.
이 방식의 log file page cache도 cgroup 사용량에 포함되므로 OCI stdout 파이프와 메모리 특성이 다를 수 있다.
Kubernetes Pod 전체(사이드카/런타임 등)의 사용량으로 일반화하지 않는다.

초기 부하 도구는 Nginx의 정상 `Connection: close`를 오류로 세었다.
정상 종료 후 재연결하도록 수정하고 최종 시험을 전부 다시 실행했다.
초기의 도구 오류/Windows 파일시스템 bind 결과는 최종값과 구분해 보관했다.

### 최종 실측 결과

게시 이미지의 무제한/제한 비교는 다음과 같다. 메모리 열은 phase 중 관찰한 cgroup 최대값이다.
throttling은 `nr_throttled / nr_periods` 비율이며 요청 오류율과 다르다.

| 게시 이미지 조건         | 실측 req/s | 평균 CPU(m) | 메모리(Mi) | p95(ms) | throttled periods |
| ------------------------ | ---------- | ----------- | ---------- | ------- | ----------------- |
| 무제한, 대표 20          | 20.1       | 3.8         | 5.35       | 0.58    | 0%                |
| 무제한, 증가 200         | 200.1      | 25.7        | 5.66       | 0.41    | 0%                |
| 무제한, burst 1000       | 1000.0     | 106.1       | 7.75       | 0.36    | 0%                |
| 무제한, 동시 32 포화     | 14705.7    | 1039.6      | 31.75      | 3.69    | 0%                |
| 250m/128Mi, 대표 20      | 20.1       | 3.8         | 5.39       | 0.46    | 0%                |
| 250m/128Mi, 증가 200     | 200.1      | 25.4        | 5.81       | 0.41    | 0%                |
| 250m/128Mi, burst 1000   | 1000.0     | 110.5       | 7.73       | 0.39    | 0%                |
| 250m/128Mi, 동시 32 포화 | 3408.1     | 249.8       | 15.33      | 75.66   | 99.34%            |

무제한 기동은 48.5ms/누적 CPU 21.0ms/기동 memory peak 6.32Mi,
제한 기동은 60.1ms/CPU 21.1ms/peak 5.57Mi였다. 유휴 10초 CPU 계측 증가량은 둘 다 0,
메모리는 약 5Mi였다. 유휴 CPU 0은 이 짧은 계측 구간의 값이며 항상 CPU를 안 쓴다는 뜻이 아니다.
포화까지 포함한 lifetime memory peak는 무제한 32.72Mi, 제한 17.02Mi였다.
무제한 포화 종료 anon/file은 3.79/23.04Mi, 제한은 3.79/6.73Mi였다.
file/cache를 포함하므로 이 peak를 프로세스 heap이나 고정 메모리 요구량으로 해석하지 않는다.

최종 게시 이미지 시험에서는 HTTP/연결 오류 **0**, 응답은 전부 **200**,
`memory.events`의 max/oom/oom_kill **0**이었다. 250m 제한에서 포화 처리량이 낮아지고
p95가 약 76ms로 커진 것은 관찰된 제한 효과다. 100ms보다 짧은 CPU 샘플은 250m를
넘을 수 있으며 전체 구간 평균/커널 quota와 구분한다.
이 처리량을 dev Gateway의 성능 보장이나 실제 사용자 용량으로 사용하지 않는다.

당시 main(`6219d6b`)의 로컬 production 빌드(동일 Nginx, ext4, 250m/128Mi)의 결과도 별도로 기록한다.

| 최신 빌드 조건 | 실측 req/s | 평균 CPU(m) | 메모리(Mi) | p95(ms) | throttled periods |
| -------------- | ---------- | ----------- | ---------- | ------- | ----------------- |
| 대표 20        | 20.1       | 4.7         | 5.57       | 0.66    | 0%                |
| 증가 200       | 200.1      | 28.4        | 5.92       | 0.38    | 0%                |
| burst 1000     | 1000.0     | 122.4       | 7.80       | 0.36    | 0%                |
| 동시 32 포화   | 3916.1     | 253.3       | 15.23      | 81.12   | 98.68%            |

기동 53.5ms/누적 CPU 23.3ms/기동 memory peak 6.05Mi, 유휴 CPU 증가량 0·메모리 5.25Mi,
lifetime memory peak 17.27Mi였다. 포화 구간 평균 CPU는 실제 계측값 253.3m를 그대로 기록했다.
짧은 구간의 통계값과 별개로 `cpu.max`는 위 표의 `25000 100000`이었다.
128Mi 제한 아래에서 HTTP/연결 오류·memory max/oom/oom_kill은 모두 0이었다.
최종 세 실행 합계 **385,574개 요청이 모두 200**이었고,
게시 파일 4개 × GET/HEAD, 최신 빌드 파일 18개 × GET/HEAD의 총 **52개 검사**에서
상태·Content-Type 및 GET 본문 SHA-256을 실제 산출물과 비교하여 통과했다.
이번 짧은 시험에서는 후보값을 올릴 근거가 없어 유지하되 장시간/실환경 검증 후 조정한다.

### #372 리뷰 반영: 현재 이미지와 main 통합 재검증

통합 기준 main은 `2e902de59969bdfe3310251e4801795ba357ae54`다.
#363(Payment 설정), #368(Frontend 태그), #329(CI 캐시), #369(Auth 태그), #370(Cooking 태그)의 병합 내용을
커밋하지 않은 3-way 패치로 작업 트리에 반영했다. Frontend 외 9개 파일은 main과 동일하다.
main 대비 #366의 변경은 README·dev kustomization·resources patch 3파일이며,
이번 리뷰 반영의 직접 수정은 앞의 2파일이다. 기존 resources patch 내용은 그대로다.

```text
ghcr.io/ktcloud-cloudnative-2026/team02-5xx/web-frontend:sha-6219d6bf419ca733376c317fcbc4bbbd4d38ba5b
linux/amd64 manifest sha256:c04582f1e66a264fa8a5f41a7806c873ca886b749750b88355fa79bfe243b515
```

현재 게시 이미지도 직접 내려받아 config/layer digest를 확인했다.
이전 이미지와 앞의 8개 Nginx/base layer가 같고, Nginx 바이너리·nginx.conf·entrypoint의
SHA-256도 동일하다. UID 101, Nginx 1.30.6, master 1 + worker 4, 실행 명령/8080도 유지됐다.
앱 산출물 layer는 달라졌으므로 이전 이미지의 숫자를 새 이미지의 측정값으로 재사용하지 않았다.

현재 이미지 자체를 별도 rootfs/network namespace와 cgroup에서 추가 실행했다.
환경·부하 도구·부하 단계는 최초 최종 시험과 같으며 `cpu.max=25000 100000`,
`memory.max=134217728`, swap 0을 커널 파일에서 확인했다. HTML·JS·CSS·SVG·PNG·WebP
18파일의 GET/HEAD **36개 검사**에서 상태/Content-Type 및 GET 본문 해시가 모두 일치했다.

| 현재 게시 이미지 조건 | 실측 req/s | 평균 CPU(m) | 메모리(Mi) | p95(ms) | throttled periods |
| --------------------- | ---------- | ----------- | ---------- | ------- | ----------------- |
| 대표 20               | 20.1       | 4.3         | 5.45       | 0.68    | 0%                |
| 증가 200              | 200.0      | 28.9        | 5.89       | 0.40    | 0%                |
| burst 1000            | 1000.0     | 120.6       | 7.93       | 0.33    | 0%                |
| 동시 32 포화          | 3278.6     | 249.8       | 14.82      | 81.77   | 99.34%            |

기동 50.0ms/누적 CPU 24.4ms/기동 memory peak 6.60Mi,
유휴 CPU 증가량 0·메모리 4.71Mi, lifetime memory peak **16.03Mi**였다.
추가 부하 요청 **67,602개 모두 200**, HTTP/연결 오류와 memory max/oom/oom_kill은 모두 0이었다.
현재 이미지도 단기 부하에서 기존 시작값을 유지할 근거를 제공하지만 실제 노드의 스케줄링/경쟁,
Gateway 지연·장시간 운용까지 보장하지 않는다. CPU requests/limits **25m/250m**와
메모리 requests/limits **32Mi/128Mi**는 변경하지 않았다. 위의 최초 측정 SHA/수치도 그대로다.

최신 main을 기준으로 base/dev/prod 전후 6개 렌더링을 다시 비교했다.
base/prod는 객체 전체가 동일하고 dev도 resources를 제외하면 전체가 동일하다.
main의 현재 태그와 resources patch가 함께 남고 probe·Service·HTTPRoute·replicas·labels/selector는 보존된다.
Frontend **766 PASS**, production build/admin boundary 검사와 포맷·diff 검사도 통과했다.
추가 산출물은 별도 QA 디렉터리(예: `<qa-dir>/372/`)의 `benchmark-results.json`,
`manifest-results.json`, image manifest/config/layer 및 회귀 로그로 보관한다.

PR #372의 기존 HEAD에 대한 CI Final은 SUCCESS이고 GitOps 담당의 APPROVED 리뷰를 확인했다.
리뷰에 보고된 dev CPU 1m/메모리 4Mi와 worker 4개는 담당자 실측이며 이 작업의 클러스터 직접 검증은 아니다.
이번 로컬 수정에 대한 원격 CI/추가 리뷰는 후속 제출 뒤 확인해야 한다.
다른 서비스 배포 PR과 롤링 시간을 나누고 GitOps 담당이 #368 rollout 완료를 확인한 뒤 진행한다.

### 검증 범위 및 후속 운영 확인

Node **24.22.3**, npm **11.19.1**에서 `npm ci`, `npm test`, `npm run build`,
`npm run check:admin-boundary`를 실행했다. **766 PASS, 실패/생략 0**, production build 성공.
React/lockfile/Nginx 소스는 수정하지 않았다.
Kustomize **v5.8.3**으로 base/dev/prod 변경 전후 6개 렌더링을 비교했다.
각 환경 Deployment·Service·HTTPRoute 3개가 유지되고, dev의 container resources를 제거하면
변경 전과 객체 전체가 동일하다. base/prod는 그대로 동일하고 requests ≤ limits도 확인했다.
replicas 미지정 상태, 태그, 8080, `/index.html` 두 probe, labels/selector·Route·Service를 보존했다.

산출물은 저장소 밖 별도 QA 디렉터리(예: `<qa-dir>/366/`)의 이미지 manifest/config/layer,
`benchmark-final.json`, `manifest-results.json`, before/after YAML,
`frontend-test.log`, `frontend-build.log`, 로컬 실행 도구에 보관했다.
이번에 생성한 transient Nginx unit만 종료하고 기존 worktree·bin·미커밋 변경·미리보기 서버는 보존한다.
실제 Kubernetes/OCI 기동·cgroup/노드 경쟁·Argo CD Sync/Healthy는 직접 검증하지 않았다.
최초 구현 뒤 확인한 외부 CI/리뷰와 이번 로컬 수정의 미제출 상태는 위 #372 구역과 구분한다.
128Mi를 초과시켜 OOM killer를 강제로 발생시키는 시험과 장시간 soak도 수행하지 않았다.

dev 반영 전 담당자 외 인프라 리뷰와 CI를 완료하고 기존 자동 Sync/배포 일정을 확인한다.
저장소의 `web-frontend-dev`는 자동 Sync enabled지만 현재 클러스터 상태를 직접 조회한 것은 아니다.
최초 실측 시 자동 이미지 태그 PR #364는 Closed/미병합, 후속 #368은 Open이었다.
현재 #368은 main에 병합되어 dev 태그가 `sha-6219d6b…`로 바뀌었다.
#372 수정은 그 main의 태그와 기존 resources patch를 함께 보존한다. 다음 태그 변경 시에도 실제 게시 산출물로 재검증한다.
실제 적용은 사용자 승인 후 별도 Git PR → Argo CD로 진행하고 다음을 기록한다.

1. rollout/Ready와 재시작 0, 실제 image ID, resources·probe 보존을 확인한다.
   `kubectl -n peakorder top pod -l app=web-frontend --containers`로 유휴/대표 부하 사용량을 기록하고,
   기동 peak는 더 짧은 간격의 cgroup/수집 지표로 확인한다. top만으로 peak를 판단하지 않는다.
2. `container_cpu_usage_seconds_total` rate, CFS throttled periods/전체 periods 비율,
   memory usage/working set·peak, OOMKilled·restart 수, Gateway/Nginx 4xx/5xx와 p95/p99를 함께 확인한다.
   실제 지표 이름/수집 가능 여부도 확인하며 이번에 모니터링 플랫폼 설정을 변경하지 않는다.
3. 실제 대표 부하에서 CPU가 25m를 지속 초과하면 requests 상향을 검토한다.
   limit 근처의 지속 사용·throttling과 사용자 지연이 함께 증가하면 250m limit 상향을 검토한다.
   새 값은 노드 여유와 동일 부하 재시험으로 결정하며 HPA/replicas를 이 작업에 추가하지 않는다.
4. working set이 requests 32Mi를 지속 초과하거나 기동/부하 memory peak가 limit 128Mi의 75%를
   반복 초과하면 원인·file cache·worker 수를 구분해 requests/limit을 재검토한다.
   OOM·재시작·HTTP 오류는 허용 결과로 보지 않으며 시험을 중지하고 복구한다.
   이 비율은 후속 조정용 기준이지 새 알림/SLO 합의가 아니다.
5. 복구는 Git PR에서 dev resources patch 연결과 파일을 되돌려 이전의 자원 미지정 상태로 복원한다.
   이미지·replicas·probe·다른 서비스 변경을 함께 되돌리지 않는다. 자동 Sync 후 rollout/응답을 확인한다.
   자원 상한 제거는 노드 사용량 증가 가능성이 있어 인프라 담당과 조율한다. 긴급 조치는 팀 운영 절차를 따른다.

최초 구현은 `456602c590b7fba183b572cdaa60b4f941273a63`으로 커밋되어 PR #372에 제출됐다.
이번 리뷰 반영에서는 main의 변경을 작업 트리에 3-way 패치로 통합하고 충돌을 정리했다.
기존 HEAD/브랜치 이력은 유지했으며 추가 Commit·Push·Merge·배포·클러스터 변경은 수행하지 않았다.
이 로컬 수정이 후속 커밋·Push되기 전에는 원격 PR의 충돌 상태가 갱신되지 않는다.
