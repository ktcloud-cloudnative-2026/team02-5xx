# Menu dev HTTP Probe 검증 — #402

확인일: 2026-11-26. 브랜치 `infra/402-menu-http-probes`.
최초 검증 기준 main: `c864533850f8cc880268f0f5be9a12187247b8ac`.
사용자 승인 후 fetch한 최신 main `77cafc61aa54c36773b8224bc45ea91751264f4b`를
기존 4파일 변경을 보존하면서 충돌 없이 fast-forward로 반영했다. merge commit은 만들지 않았다.
#401이 공통 monitoring README/values 두 파일만 변경했으며 Menu 배포·소스·테스트 입력은 최초 검증 기준과 동일했다.
최신 main을 기준으로 base/dev/prod 객체 비교와 Probe handler 단일성·기존 설정 보존·포맷·diff 검사를 다시 통과했다.
Menu 모듈 전체와 외부 검증 스크립트/결과가 보존돼 기존 630 PASS(실제 PostgreSQL 93건 포함)를 재사용했다.
기존 Menu 인프라 worktree를 재사용했다. 기존 #389 브랜치/커밋은 보존했고 신규 worktree는 만들지 않았다.
이 문서는 구현과 로컬 검증 결과이며 실제 dev Probe 전환 완료 기록이 아니다.

## 선행 근거와 변경 범위

- [Issue #402](https://github.com/ktcloud-cloudnative-2026/team02-5xx/issues/402)의 dev 한정 범위를 따른다.
- [#365](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/365)는 `46d1801`,
  [#394](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/394)는 `d817c67`,
  [#392](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/392)는
  `55c0d9b7435c909faaf80ef04d5eb134db154447`로 병합됐으며 모두 기준 main의 조상이다.
- [#394 실제 dev 확인 댓글](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/394#issuecomment-7181926409)은
  Synced/Healthy, Ready 1/1, 재시작 0, Actuator health/Prometheus와 관리자 역할별 응답을 보고했다.
  기동 중 기존 liveness 연결 거부 1회(재시작 없음)도 기록돼 있다.
- [#280 실제 dev 검증](https://github.com/ktcloud-cloudnative-2026/team02-5xx/issues/280#issuecomment-7183167974)은
  같은 이미지로 Gateway JWT/역할·관리자 CRUD·고객/내부 API·NetworkPolicy 등 40 PASS를 기록했다.
  Issue #402는 해당 dev 이미지의 liveness/readiness 200 UP 확인을 명시한다.
  이들은 선행 실환경 기록이며 이번 로컬 실행 결과와 구분한다.
- #392 병합은 확인했으나 이번 작업에서는 그 후의 dev 롤링 안정화나 Loki 수집을 새로 조회하지 않았다.
  #389는 조회 당시 Open이었다. 실제 Probe 반영 전 담당자 확인이 필요하다.
- 작성자 Open PR과 리뷰 요청 PR은 조회 당시 없었다. Kubernetes 변경의 필수 외부 리뷰와 CI는 후속 PR에서 확인한다.

변경 파일은 dev `kustomization.yaml`, 신규 `probes-patch.yaml`, 배포 README와 이 문서다.
README의 오래된 Actuator 미지원/TCP-only 설명과 dev 이미지 설명을 현재 설정에 맞췄다.
과거 #354 실측 결과는 변경하지 않았다.
애플리케이션 코드·Gradle·properties·API·DB 계약은 수정하지 않았다.

## Probe 선택과 교체

| Probe     | HTTP 경로                    | 포트   | periodSeconds | failureThreshold |
| --------- | ---------------------------- | ------ | ------------- | ---------------- |
| startup   | `/actuator/health/liveness`  | `http` | 5             | 24               |
| readiness | `/actuator/health/readiness` | `http` | 10            | 미설정(기본 3)   |
| liveness  | `/actuator/health/liveness`  | `http` | 20            | 미설정(기본 3)   |

현재 Auth·Order base와 세 Probe 객체가 동일함을 자동 비교했다.
startup 성공 전에는 readiness/liveness를 시작하지 않으며 약 120초의 기동 검사 예산을 둔다.
실제 기동 완료 시점이나 kubelet 재시작 동작을 이 수치만으로 보장하지 않는다.
timeoutSeconds와 successThreshold는 기존 사례대로 명시하지 않아 기본 1초/1회를 사용한다.
readiness/liveness의 `$patch: replace`는 각 기존 Probe 객체를 통째로 교체한다.
단순 httpGet 병합으로 tcpSocket이 남는 문제를 방지하며 최종 handler는 각각 httpGet 하나다.
startup도 httpGet 하나이고 모든 HTTP port는 containerPort 8080의 이름 `http`를 참조한다.

base/prod는 이미지가 placeholder인 기존 상태이므로 TCP readiness/liveness와 startup 미설정을 유지한다.
검증되지 않은 prod 이미지에 HTTP Probe를 적용하지 않는다.

## Kustomize 전후 비교

Kustomize v5.8.3, Python/PyYAML로 기준 HEAD의 사본과 작업 트리를 각각 렌더링했다.

| 환경 | 전/후 객체 수 | 비교 결과                                       |
| ---- | ------------- | ----------------------------------------------- |
| base | 3 / 3         | 전체 객체 동일, TCP Probe 유지                  |
| dev  | 6 / 6         | 세 Probe만 변경, 각 handler 1개, tcpSocket 없음 |
| prod | 3 / 3         | 전체 객체 동일, TCP Probe 유지                  |

dev 결과의 세 Probe를 변경 전 값으로 복원한 사본은 기존 객체 목록 전체와 동일했다.
따라서 Deployment의 나머지 필드와 Service·고객/관리자 HTTPRoute·JWT SecurityPolicy·HPA도 동일하다.
이미지 태그, Secret 참조, ECS env, dev 관리자 true/prod false,
CPU requests/limits 100m/1, 메모리 384Mi/768Mi, JVM MaxRAMPercentage 60.0,
dev Hikari 4/1, preStop 10초, 종료 유예 50초와 포트 8080을 추가로 확인했다.
Argo CD replicas 비교 제외/RespectIgnoreDifferences 및 NetworkPolicy 파일도 수정하지 않았다.

## 실제 게시 이미지 확인과 로컬 HTTP

현재 dev 태그를 GHCR에서 익명 pull 권한으로 읽고 이미지 manifest/config 및 app.jar를 직접 확인했다.
Registry의 임시 pull 인증값은 출력·저장하지 않았다.

```text
image: ghcr.io/ktcloud-cloudnative-2026/team02-5xx/menu:sha-46d1801215997aa767ab12fa53249acd06b710d1
manifest digest: sha256:de53bf04d895785dcdc2ad18d767af7658ca585b58acdb6922314b8ef46ab417
app.jar SHA-256: 73bfbcfbfc54727cc42cd24e152ee48867d90bd48b8a95dcdc773bf38e70931d
entrypoint: ["java", "-jar", "app.jar"]
exposed port: 8080/tcp
```

이미지 revision 라벨은 태그의 전체 커밋 SHA와 일치한다.
JAR에는 Actuator/autoconfigure 4.1.2와 Prometheus registry 1.17.2가 있고,
`management.endpoint.health.probes.enabled=true`가 있다. 커스텀 health group 설정은 없다.
해당 게시 커밋과 기준 main 사이 Menu 애플리케이션 소스 차이도 없다.

게시 JAR을 WSL2 Ubuntu 24.04의 별도 rootfs/mount 격리에서 Java 21.0.13.1로 실행했다.
새 PostgreSQL 16.15 data directory·전용 DB/role·무작위 임시 비밀번호를 사용했다.
기존 실행 도구는 읽기 전용 입력으로 사용하고 기존 QA/data directory에는 쓰지 않았다.
loopback의 임시 HTTP/DB 포트로 충돌을 피했다. 이 SERVER_PORT 재지정은 로컬 도구에만 있다.
ECS, dev 관리자 true 및 Hikari 4/1을 주입했다. 실제 OCI 컨테이너나 kubelet 실행은 아니다.

| 요청                         | 결과                     | 단일 로컬 응답시간 |
| ---------------------------- | ------------------------ | ------------------ |
| `/actuator/health`           | 200 UP, 그룹 이름만 공개 | 약 27.3ms          |
| `/actuator/health/liveness`  | 200 `{"status":"UP"}`    | 약 5.3ms           |
| `/actuator/health/readiness` | 200 `{"status":"UP"}`    | 약 2.6ms           |

업무 요청 후 liveness/readiness도 다시 200 UP이었다. 이 단일 측정은 dev 지연/timeout 적정성이나 SLO 검증을 대체하지 않는다.
고객 목록/상세와 내부 존재/구매 검증 200, 잘못된 JSON 400,
관리자 신원 형식 오류 401·CUSTOMER 403·STORE_ADMIN 200을 확인했다.
관리자 역할 시험은 **로컬 신원 헤더 기반 서비스 검사**이며 Gateway JWT/E2E 검증이 아니다.
Prometheus에서 Hikari 최대 4를 확인했고 비허용 env/beans/configprops/heapdump/loggers는 404였다.
선택한 합성 JWT·개인정보·본문 표식과 임시 DB 비밀번호의 로그 검출은 0건이었다.
ECS JSON 39건 파싱, JVM 안내 1행 별도 분류, SIGTERM 정상 종료를 확인했다.
새 검증 JVM을 종료한 뒤 해당 PostgreSQL만 종료했고 임시 비밀번호/EnvironmentFile을 제거했다.

### DB 장애 의미와 이번 범위

[#365의 과거 격리 DB 시험](menu-observability-validation-361.md#db-장애-시-health-의미--실제-중단복구)에서는
DB 장애 시 전체 health 503 DOWN, readiness/liveness 200 UP, 메뉴 조회 500이었다.
**기본 readiness는 DB 준비를 보장하지 않는다.** 이번에도 그 의미를 유지한다.
DB를 liveness에 추가하거나 readiness group을 바꾸지 않았다.
이번 검증은 정상 DB만 사용했다. 공유 dev DB 중단·부하 시험·장애 주입은 하지 않았다.

## 회귀·형식 검증과 산출물

Windows PowerShell 5.1, Oracle Java 21.0.7 및 기존 Gradle Wrapper 8.14.3을 사용했다.
신규 격리 PostgreSQL 18을 loopback 임시 포트로 실행해 기존 DatabaseTests를 활성화했다.
외부 init script와 `--project-cache-dir`로 새 QA 경로에 build/cache를 분리했다.
기존 worktree build/cache 및 QA 결과를 덮어쓰지 않았다. Spotless 자동 수정은 하지 않았다.
최종 해시/상태 대조에서 다른 worktree 7개, 보호 대상 기존 build/cache·QA·bin 541파일과
작업 시작 시 TCP 리스너 40개를 모두 보존했다. 기존 #389 브랜치 참조도 그대로다.

```text
gradlew.bat --no-daemon --project-cache-dir <qa>/gradle-project-cache
  --init-script <qa>/isolated-build.gradle
  spotlessCheck test build --rerun-tasks --console=plain
```

결과는 **BUILD SUCCESSFUL, 630 PASS**, 실패/오류/생략 0, 실제 PostgreSQL 테스트 **93건**이다.
관리자 활성/비활성·신원/역할, 고객 ME-01/02·내부 MI-01/02, Actuator/노출 검사를 포함한다.
Kustomize 객체 비교와 YAML 포맷, `git diff --check`를 검사했다.
로컬 도구는 저장소 밖 별도 `Peak_Order-402-qa` 디렉터리에 있으며,
`manifest-results.json`, before/after YAML, `image-results.json`, `runtime-results.json`,
콘솔 캡처, `regression-results.json`, Gradle/JUnit 결과를 보관한다.

## 미검증과 실제 dev 반영 절차

이번에는 클러스터 접근·변경·배포를 수행하지 않았다.
실제 kubelet의 startup/readiness/liveness 스케줄·실패·재시작, 새 롤링의 안정성,
실제 dev/prod 응답·cgroup·OOM, 이번 변경의 원격 CI/필수 외부 리뷰는 미검증이다.
로컬 성공이나 선행 dev 기록을 이번 Probe 배포 성공으로 해석하지 않는다.

1. 후속 PR에서 서비스/인프라 담당 리뷰와 CI를 확인한다. #392 롤링/로그 안정화를 담당자에게 확인한다.
2. [#186](https://github.com/ktcloud-cloudnative-2026/team02-5xx/issues/186)의 동시 롤링 제한과
   DB 연결 예산을 지키고 별도 승인 후 Git PR → Argo CD 경로로 dev만 반영한다.
3. Synced/Healthy·rollout·Pod Ready를 확인한다. startup 성공 후 readiness/liveness가 정상인지,
   이벤트의 Probe 실패/재시작/OOM과 HTTP 오류가 없는지 확인한다. HPA·replicas 정책·Hikari 4/1도 재확인한다.
4. 고객 200, 관리자 무토큰 401/STORE_ADMIN 200, 대표 내부 API와 Actuator 외부 비노출을 재검증한다.
   기존 Gateway JWT/NetworkPolicy를 유지하고 실제 토큰은 로그/검증 문서에 기록하지 않는다.
5. 문제 시 후속 Git PR에서 dev의 `probes-patch.yaml` 연결과 파일만 제거해 TCP로 복구한다.
   이미지·ECS·인증·Hikari·자원·HPA는 함께 되돌리지 않는다. prod는 별도 검토 대상이다.

최초 구현/로컬 검증 단계에서는 Commit·Push·PR 생성·Merge·배포를 하지 않았다.
이후 사용자 승인에 따라 최신 main 반영과 재검증을 완료하고 #402 관련 4파일만 커밋한다.
Push·PR 생성·PR Merge·배포는 수행하지 않는다.
