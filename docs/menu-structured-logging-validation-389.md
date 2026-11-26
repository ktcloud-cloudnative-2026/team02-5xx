# Menu ECS JSON 로그 검증 — #389

확인일: 2026-11-26. 작업 브랜치: `infra/389-menu-structured-logging`.
기준 main: `55c5ff6a9d4862e149f84f75b8fc51119dd4c2dd`.
최초 확인 시 main `099a7e8`에 #360이 병합돼 있었고, 작업 중 #388이 병합되어 기준만 fast-forward로 갱신했다.
#388의 HPA는 main 상태 그대로 보존한다. 이 과정에서 merge commit을 만들지 않았다.

[Issue #389](https://github.com/ktcloud-cloudnative-2026/team02-5xx/issues/389),
[공통 관측 설계 3-1~3-4](observability.md#3-로그-형식-모든-서비스-같게),
Auth·Cooking·Order의 base Deployment에 있는 같은 환경 변수 선언을 기준으로 한다.
기존 #354의 완료된 worktree를 재사용하고, 기존 `infra/354-menu-resource-readiness` 브랜치 참조는 보존했다.
다른 worktree·미추적 bin·기존 서버·QA 산출물은 변경하지 않는다.

## 변경 범위

`deploy/apps/menu-service/base/deployment.yaml`의 기존 env 목록에 다음만 추가했다.

```yaml
# docs/observability.md 3-1 (#389): Spring Boot 내장 ECS JSON 로그.
- name: LOGGING_STRUCTURED_FORMAT_CONSOLE
  value: ecs
```

Spring Boot **4.1.2 내장 ECS** 기능을 사용한다. 새 라이브러리·Java 업무/인증 코드·
`application.properties`·로컬 기본 로그 형식은 바꾸지 않았다.
dev/prod는 base를 상속하므로 둘 다 렌더링에 포함되며 실제 prod 적용은 하지 않았다.
검증 기록은 이 별도 문서로 남겨 진행 중인 README 작업과의 충돌을 줄였다.

#365(Actuator/Prometheus)는 미병합 상태로 확인했고 가져오지 않았다.
HTTP probe, ServiceMonitor/Alloy/Loki/Grafana, 요청 ID/업무 로그, HPA/replicas 정책,
prod 전용 자원/Hikari, 이미지 태그를 추가하거나 변경하지 않았다.

## 검증 환경과 기존 산출물 보호

- 회귀: Windows 11/PowerShell 5.1, **Oracle JDK 21.0.7**, 기존 **Gradle Wrapper 8.14.3**,
  신규 data directory·role·DB와 loopback 임시 포트의 **PostgreSQL 18**.
- 실제 실행: WSL2 Ubuntu 24.04의 별도 rootfs·mount 격리, **Temurin Java 21.0.13.1**,
  신규 data directory·role·DB와 loopback 임시 포트의 **PostgreSQL 16.15**.
  기존 검증용 JRE/PostgreSQL 실행 파일은 읽기 전용 입력으로 사용하고 기존 data directory는 사용하지 않았다.
- systemd가 Java를 직접 실행하고 SIGTERM을 전달했다. 정상 종료 로그와 unit 종료 성공을 함께 확인했다.
  OCI/Kubernetes 실행이나 컨테이너 PID 1 검증은 아니다.
- Gradle의 build directory와 project cache를 외부 QA 디렉터리로 지정해 기존 worktree의
  `build/`, `.gradle/` 및 과거 테스트 산출물을 덮어쓰지 않았다. 외부 init script는 출력 경로만 바꾼다.
  제품 build.gradle은 바꾸지 않았다.
- 비밀번호는 실행마다 무작위 생성해 환경 변수/임시 EnvironmentFile로 전달했다.
  임시 비밀번호 파일과 EnvironmentFile은 제거했다. 실제 운영 비밀값/토큰은 사용하지 않았다.

## 실제 콘솔 로그 비교

동일한 현재 코드의 실행 JAR을 ECS 미설정/설정으로 각각 기동하고, 기존 게시 JAR도 ECS로 별도 실행했다.
두 현재 코드 실행의 다른 설정은 같으며 관리자 토글은 명시적 false, Hikari는 4/1이다.
JVM timezone을 Asia/Seoul로 둔 검증 환경에서도 ECS timestamp가 UTC인지 확인했다.
이 timezone 옵션은 검증 도구에서만 사용했고 배포 환경 변수에는 추가하지 않았다.

| 실행                    | 애플리케이션 로그                         | 별도 비로그 출력         | 결과                         |
| ----------------------- | ----------------------------------------- | ------------------------ | ---------------------------- |
| 현재 코드, ECS 미설정   | 기존 텍스트 286물리행, ECS JSON 0건       | JVM 안내·Spring 배너 8행 | 텍스트 유지, 정상 종료       |
| 현재 코드, ECS 설정     | **46건 모두 한 줄 JSON**, 텍스트 로그 0행 | JVM 안내 1행             | UTC/필수 필드·정상 종료 PASS |
| 기존 게시 JAR, ECS 설정 | **46건 모두 한 줄 JSON**, 텍스트 로그 0행 | JVM 안내 1행             | UTC/필수 필드·정상 종료 PASS |

이 수치는 해당 실행의 기록 수다. 텍스트 stack trace의 물리행과 JSON 레코드 수는 일대일 비교하지 않는다.
ECS의 배너/예외 메시지에 포함된 줄바꿈은 JSON 문자열 안에 escape되며 물리행 분할 파싱을 통과했다.
`Picked up JAVA_TOOL_OPTIONS: ...`는 JVM/런처 출력으로 애플리케이션 로그와 분리했다.
미분류 콘솔 행은 0건이었다. 배너나 JVM 출력을 감추기 위한 제품 설정은 추가하지 않았다.

각 JSON 행을 `json.loads`로 파싱하고 다음을 검사했다.

- `@timestamp`가 `Z`로 끝나고 UTC offset이 0이다.
- `log.level`이 유효하며 이번 실행에서 **INFO/WARN/ERROR**를 확인했다.
- `service.name`은 모두 **menu-service**이고 `message`가 비어 있지 않다.
- 기동 완료, 기존 HTTP 오류 처리, `Graceful shutdown complete`, Hikari `Shutdown completed` 메시지가 있다.
- 세 실행 모두 SIGTERM 후 정상 종료 로그와 systemd `Result=success`, 종료 코드 0을 확인했다.

실제 ECS 기동 로그 중 주요 필드:

```json
{
  "@timestamp": "2026-11-26T02:44:26.961202431Z",
  "log": { "level": "INFO" },
  "service": { "name": "menu-service" },
  "message": "Started MenuServiceApplication in 3.6 seconds (process running for 3.943)"
}
```

기존 게시 JAR은 `sha-eac2e88c7da2ed894689d4868713467c975ee3f4` 이미지에서 확인한 파일이며 SHA-256은
`9dc251e310161ca2e591caf299a867a239f943fb996be7472ef46e17fff0be7b`이다.
Boot 4.1.2 내장 기능이 동작해 ECS 자체에는 #365 의존성이나 새 업무 코드 이미지가 필요하지 않음을 확인했다.
이 결과가 현재 클러스터의 로그 형식이나 관리자 기능 활성화 완료를 뜻하지는 않는다.

## 대표 HTTP·오류 및 민감 입력 검사

각 실행에서 고객 목록/상세와 query 요청, 내부 존재/구매 검증 **200**, 잘못된 JSON **400**을 확인했다.
현재 코드의 관리자 off **403**, 관리자 코드가 없는 기존 게시 JAR의 해당 경로 **404**도 유지됐다.
정상 요청마다 업무/접근 로그를 새로 넣지는 않았다. HTTP 응답과 기존 로그를 각각 검증했다.

이번에 만든 PostgreSQL만 잠시 중단해 메뉴 조회 **500**과 기존 sanitized ERROR 로그를 생성하고,
DB 재시작 후 조회 200 복구를 확인했다. 이 보조 시험의 Hikari connection timeout만 1000ms로 짧게 지정했고
제품 설정은 바꾸지 않았다. 기존 DB나 다른 실행 서버를 중단하지 않았다.

다음 합성 값이 캡처한 전체 콘솔 로그 어디에도 없는지 확인했다.

- 임시 DB 비밀번호
- 합성 JWT와 `Authorization: Bearer ...` 값(무효 서명이며 실제 토큰 아님)
- 합성 이메일(`example.invalid`)·신원 헤더 값·query 표식
- 잘못된 요청 본문의 표식과 실제 성공 응답에 포함시킨 별도 본문 표식

비밀번호·JWT 전체 문자열·개인정보 표본·요청/응답 본문 표식의 검출은 모두 **0건**이었다.
운영 비밀값/토큰은 입력하지 않았다. 검증 기록의 예시에도 이 값들을 싣지 않는다.
이 검사는 선택한 요청 경로/입력과 기본 INFO 수준에 한정되며 임의 DEBUG 설정이나 모든 예외 경로를 검증한 것은 아니다.

## Kustomize와 기존 배포 설정

Kustomize **v5.8.3**으로 최종 기준 main과 변경 후 base/dev/prod 총 6개 렌더링을 비교했다.
각 결과에서 새 ECS 환경 변수 하나를 제거하면 기존 객체 전체가 동일했다. 환경 변수 중복은 0건이다.

| 환경 | 리소스 수 전/후 | ECS | 관리자 활성화 |
| ---- | --------------- | --- | ------------- |
| base | 3 / 3           | ecs | false         |
| dev  | 6 / 6           | ecs | true          |
| prod | 3 / 3           | ecs | false         |

이미지 태그/Secret, CPU 100m/1·메모리 384Mi/768Mi·JVM 60%, dev Hikari 4/1,
preStop 10초·종료 유예 50초·TCP probe, Service/HTTPRoute/SecurityPolicy가 보존됐다.
dev의 #388 HPA와 기존 Application replicas 비교 제외/RespectIgnoreDifferences도 main과 동일하다.
prod에 HPA나 Hikari 설정을 새로 추가하지 않았다. NetworkPolicy도 그대로다.

## 회귀·충돌 가능성·산출물

`spotlessCheck test build --rerun-tasks --no-daemon --console=plain` 결과 **611 PASS**,
실패/오류/생략 **0**, 실제 PostgreSQL 테스트 **91건**이다.
관리자 활성화/비활성화·신원/역할, 고객 ME-01/02 및 내부 MI-01/02를 포함한다.
#388 기준 갱신 전후 `services/menu-service` 전체가 동일해 완료한 테스트와 실행 JAR의 코드 동일성을 확인했다.
문서/YAML 포맷과 `git diff --check`도 통과했다.

#365는 Gradle/properties/테스트와 별도 관측성 문서이므로 이번 2파일과 직접 겹치지 않는다.
#388은 dev HPA/kustomization/README를 변경했고 최종 기준 main에 이미 포함돼 그대로 보존했다.
README는 수정하지 않아 과거 검증 기록 및 진행 중 작업과의 불필요한 충돌을 줄였다.
다른 PR이 base Deployment env를 바꾸면 병합 전 환경 변수 중복과 렌더링을 다시 확인해야 한다.

산출물은 저장소 밖 별도 `<qa-dir>/389/`에 `regression-results.json`, `runtime-results.json`,
text/ECS 콘솔 캡처, JVM/배너 분류, JSON 샘플, `manifest-results.json`, before/after YAML로 보관한다.
검증을 위해 시작한 PostgreSQL과 JVM만 종료했고 기존 QA 파일은 보존한다.
최종 대조에서 다른 worktree 7개, 기존 build/cache 186파일, QA 145파일, 미추적 bin 183파일을 보존했다.
기존 리스너 47개 중 서버를 포함한 44개는 유지됐고, 나머지 3개는 Gradle 자체 로그에서
180분 유휴 시간 만료로 정상 종료한 daemon임을 확인했다. 기존 서버를 종료하는 명령은 실행하지 않았다.

## 실제 반영 전 남은 확인

실제 클러스터 Pod 롤링/자원 제한/preStop, Argo CD Sync/Healthy, prod 실행,
`kubectl logs` 및 Alloy/Loki 수집, 원격 CI와 이번 변경의 필수 외부 리뷰는 수행하지 않았다.
stdout 파일은 로컬 검증용 캡처이며 제품 파일 로그 설정이나 수집 agent를 추가한 것이 아니다.

환경 변수 변경은 Pod 롤링을 유발한다. 담당자 외 리뷰/CI 후 별도 승인을 받고,
#186의 배포 순서·동시 롤링 제한과 #280/#360의 Gateway 정책·NetworkPolicy 선행 검증 및
새 관리자 이미지 활성화 절차를 따른다. 기존 구 이미지의 관리자 404와 새 코드 off 403은 구분한다.
반영 후 Ready/재시작/HTTP 오류와 `kubectl logs` JSON·민감 값 미노출을 확인하고
모니터링 담당과 Loki 수집을 검증한다. prod 적용은 별도 승인 대상이다.
롤백이 필요하면 Git PR에서 이번 환경 변수만 되돌리고 이미지·인증·자원 설정은 함께 되돌리지 않는다.

이번 작업은 구현/로컬 검증까지만 수행했다. Commit·Push·PR 생성·PR Merge·배포는 하지 않는다.
