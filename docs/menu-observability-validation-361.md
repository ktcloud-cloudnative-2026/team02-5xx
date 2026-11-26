# Menu Actuator·Prometheus 검증 — #361

확인일: 2026-11-26. 기준 `origin/main`: `6219d6bf419ca733376c317fcbc4bbbd4d38ba5b`.
작업 브랜치 `infra/361-menu-observability`, worktree `C:/M/Peak_Order-menu-observability`.
[Issue #361](https://github.com/ktcloud-cloudnative-2026/team02-5xx/issues/361),
[공통 관측 설계 1-2](observability.md#1-2-모든-java-서비스-공통-설정),
[병합된 Auth PR #325](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/325)를 기준으로 한다.
이번 범위는 애플리케이션 지표 제공과 로컬 검증이다. 실제 dev 관측 완료를 뜻하지 않는다.

## 변경 파일과 목적

| 파일 | 변경 목적 |
| --- | --- |
| `services/menu-service/build.gradle` | Actuator와 Prometheus registry 의존성 추가 |
| `services/menu-service/src/main/resources/application.properties` | 노출 허용 목록, probe 그룹, application 라벨, HTTP histogram 설정 |
| `services/menu-service/src/test/java/com/peakorder/menu/MenuObservabilityHttpTests.java` | 실제 HTTP·registry를 통한 상태/노출/HTTP 지표/민감 입력 검사 17건. Repository는 모의 구현 |
| `services/menu-service/src/test/java/com/peakorder/menu/MenuObservabilityDatabaseTests.java` | 실제 PostgreSQL·Flyway·Repository·Hikari·HTTP 지표 검사 2건. 모의 구현 없음 |
| 이 문서 | 실측 결과, 보안 경계, 통합 영향 및 후속 절차 기록 |

`spring-boot-starter-actuator`는 health·availability 및 운영 지표 자동 구성을 제공하고,
`micrometer-registry-prometheus`는 이를 `/actuator/prometheus`로 내보낸다.
각각 implementation/runtimeOnly이며 버전을 직접 지정하지 않았다.
기존 Boot BOM 4.1.2가 관리하며 실행 JAR에서 Actuator 4.1.2,
Micrometer Prometheus 1.17.2, HikariCP 7.0.2를 확인했다.
새 로깅 라이브러리나 업무 지표, 사용자/메뉴 ID 태그는 추가하지 않았다.

| 설정 | 역할 |
| --- | --- |
| `management.endpoints.web.exposure.include=health,info,prometheus` | 이 세 endpoint만 HTTP로 노출 |
| `management.endpoint.health.probes.enabled=true` | Kubernetes 밖 로컬 환경에서도 liveness/readiness 그룹 활성화 |
| `management.metrics.tags.application=${spring.application.name}` | 지표에 `application="menu-service"` 라벨 추가 |
| `management.metrics.distribution.percentiles-histogram.http.server.requests=true` | HTTP 요청 timer의 누적 histogram 버킷 생성. 여러 Pod의 p95 집계에 사용 |

properties 끝에 독립 구역으로 배치했다. 기존 DB·Flyway·Jackson 속성과 인증·인가 코드는 그대로다.
health 상세 노출은 기본값을 유지한다. readiness에 DB를 포함하는 추가 설정은 하지 않았다.

## 선행 작업 상태 및 통합 영향

2026-11-26 조회 시 #280·#354는 Open이고, [PR #360](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/360)
(`a87d73e`)과 [PR #357](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/357)
(`8b6fb54`)도 Open/미병합이다. 두 PR의 CI Final은 SUCCESS이고 외부 review 제출과
inline review thread는 모두 0건이었다. 작성자 Open PR은 두 건이며 요청받은 다른 PR 리뷰는 없었다.
이 상태는 리뷰 완료나 병합 승인을 뜻하지 않는다.

- #357은 배포 README·base Deployment·dev Hikari patch·dev kustomization 4파일이다.
  이번 변경과 파일이 겹치지 않는다. 이번 실측 Hikari 최대 10은 main의 기본값이며 #357의 dev 4/1 적용 증거가 아니다.
- #360은 23파일이며 이번 변경과 겹치는 파일은 `application.properties` 한 개다.
  main/이번 파일/#360 파일을 저장소 밖에서 `git merge-file -p`로 3-way 비교했다.
  충돌 없이 `menu.admin.enabled=${MENU_ADMIN_ENABLED:false}`와 관측성 4개 키가 각각 한 번 보존됐다.
  이 비교는 텍스트 통합 영향 확인이며 #360 제품 코드 실행 검증은 아니다.
- 두 미병합 PR을 merge/cherry-pick하거나 그 제품 코드를 복사하지 않았다.
  현재 main의 `AdminMenuGatewayTrust` 상시 false 및 관리자 403 계약을 유지한다.
  기존 관리자 통합 테스트의 정상 CRUD는 main에 있던 모의 trust 경계를 사용한다.
- 선행 PR의 head/main이 달라지면 통합 후 설정 중복·관리자 정책·전체 회귀·이미지 내용을 다시 확인해야 한다.

## 실행 환경과 검증 결과

Windows 11/PowerShell 5.1, Oracle JDK **21.0.7**, 기존 Gradle Wrapper **8.14.3** 사용.
저장소 밖에 신규 PostgreSQL **18** data directory·전용 role·테스트/런타임 DB를 만들고
loopback의 사용 가능한 별도 포트에서만 실행했다. 비밀번호는 실행 중 무작위 생성하여 환경 변수로 전달했다.
공유 dev/prod DB 및 기존 검증용 data directory는 사용하지 않았다.

Menu 디렉터리에서 `MENU_DB_TEST_URL`, `MENU_DB_TEST_USERNAME`, `MENU_DB_TEST_PASSWORD`를
폐기 가능한 테스트 DB로 지정하여 실행했다. 비밀값은 출력하지 않는다.

```powershell
$env:JAVA_HOME = 'C:/Program Files/Java/jdk-21'
.\gradlew.bat --version
.\gradlew.bat --no-daemon spotlessApply spotlessCheck test build --rerun-tasks --console=plain
git diff --check
```

- Gradle **BUILD SUCCESSFUL**. JUnit XML 합산 **553 PASS**, 실패/오류/생략 **0**.
- main 기존 534건과 신규 19건(HTTP 17 + 실제 DB 2)을 포함한다.
  실제 PostgreSQL 테스트는 기존 91 + 신규 2 = **93건**이다.
- 고객 ME-01/02, 내부 MI-01/02, 관리자 기본 차단/권한 및 기존 모의 trust 기반 CRUD 회귀 모두 통과했다.
  기존 테스트 및 업무 코드는 수정하지 않았다.
- 실행 가능한 JAR도 별도 runtime DB와 loopback HTTP 포트로 기동했다.
  fixture로 생성한 실제 메뉴의 목록/상세 200, 미존재 상세 404, 내부 existence 200,
  관리자 목록 403을 확인했다. HTTP 지표는 실제 요청 후 scrape했다.
- 실제 DB 연결의 Hikari active/idle/max/pending 및 acquire count, JVM 메모리·GC allocation을 확인했다.
  `jcmd <이번 검증 JVM PID> GC.run` 후 이벤트 의존적인 GC pause count 생성도 확인했다.
  GC 진단 명령은 운영 설정이 아니다.

### DB 장애 시 health 의미 — 실제 중단/복구

이번 검증 전용 PostgreSQL만 `pg_ctl -D <이번 전용 data directory> -m fast -w stop`으로
중단한 뒤 같은 실행 JAR에 요청했다. 그 DB를 다시 시작하여 복구도 확인했다.
장애 대기를 줄이기 위해 이 runtime 실험에만 Hikari connection timeout 1000ms를 사용했다.
제품 properties·pool 크기·probe는 변경하지 않았다.

| 요청 | DB 정상 | 전용 DB 중단 | DB 복구 |
| --- | --- | --- | --- |
| `/actuator/health` | 200 UP | **503 DOWN** | 200 UP |
| `/actuator/health/liveness` | 200 UP | **200 UP** | 200 UP |
| `/actuator/health/readiness` | 200 UP | **200 UP** | 200 UP |
| `GET /api/v1/menus` | 200 | **500** | 200 |

**기본 readiness는 DB 장애를 감지하지 않는다.** 현재 설정에서 readiness UP은 DB 준비 완료를 보장하지 않는다.
전체 health는 DB를 검사하지만 liveness/readiness는 애플리케이션 availability 상태를 검사한다.
DB 장애가 모든 Pod의 readiness를 동시에 내리는 정책이 적절한지는 후속 probe 설계에서 결정한다.
이는 [Spring Boot health/probe 문서](https://docs.spring.io/spring-boot/reference/actuator/endpoints.html)의
기본 readiness 동작과도 일치한다. 건강한 상태만 시험하여 DB 장애 감지를 주장하지 않는다.

### 실제 Prometheus 출력 예시

검증 실행 JAR에서 수집한 일부 sample이다. 값은 scrape 시점에 따라 달라진다.

```text
http_server_requests_seconds_count{application="menu-service",error="none",exception="none",method="GET",outcome="SUCCESS",status="200",uri="/api/v1/menus"} 2
http_server_requests_seconds_bucket{application="menu-service",error="none",exception="none",method="GET",outcome="SUCCESS",status="200",uri="/api/v1/menus",le="0.001"} 0
jvm_memory_used_bytes{application="menu-service",area="heap",id="G1 Eden Space"} 0.0
jvm_gc_pause_seconds_count{action="end of major GC",application="menu-service",cause="Diagnostic Command",gc="G1 Old Generation"} 1
hikaricp_connections_active{application="menu-service",pool="HikariPool-1"} 1.0
hikaricp_connections_max{application="menu-service",pool="HikariPool-1"} 10.0
hikaricp_connections_acquire_seconds_count{application="menu-service",pool="HikariPool-1"} 7
```

HTTP 404 상세 요청은 `uri="/api/v1/menus/{menuId}"`로 집계된다.
신규 HTTP 테스트는 200·404·500의 status와 route template, histogram 존재를 확인하고,
서로 다른 실제 ID가 지표에 들어가지 않는지 검사한다.
대시보드에서는 공통 설계대로 `/actuator/**`를 제외하고 counter에 rate/increase를 사용한다.

## 보안 검증과 접근 경계

- `env`(개별 property 경로 포함), `beans`, `configprops`, `heapdump`, `loggers`(ROOT 포함),
  `metrics`, `mappings`, `threaddump`, `shutdown`, `flyway`의 HTTP GET은 **404**였다.
  `/actuator/info`는 200/빈 객체였다.
- health/liveness/readiness 응답에 `components`, `details`, JDBC 주소·DB 사용자·비밀번호가 없다.
  전체 health는 그룹 이름과 status만, 개별 probe는 status만 반환했다. DOWN에서도 상세 비공개를 유지했다.
- 합성 canary를 query·Bearer 헤더·사용자 헤더·잘못된 JSON 본문·모의 예외 메시지에 넣었다.
  HTTP 테스트의 캡처 로그와 지표에서 이 값이 없음을 확인했다.
  실제 JAR에서도 query·헤더·본문 canary, 실제 임시 DB 비밀번호가 로그/지표에 없음을 검사했다.
  실제 JWT나 개인정보는 입력하지 않았다. 로그 미노출 검증은 이 입력/경로/기본 로그 수준에 한정된다.
- 기존 예외 handler는 예외 메시지/스택 대신 클래스 이름만 기록한다. 요청 본문 로깅이나 사용자 태그를 추가하지 않았다.
  DB 장애 때 프레임워크 로그에는 연결 오류/SQLState 등 진단 정보가 기록되지만 테스트 비밀번호나 입력 canary는 없었다.
- 저장소의 `deploy/apps/menu-service/base/httproute.yaml`은 GET `/api/v1/menus`와
  단일 상세 경로만 전달한다. `/actuator/**` 및 `/internal/**`에 대한 공개 Route는 없다.
  미병합 #360의 관리자 Route도 actuator를 열지 않는다.
- `deploy/platform/network-policies.yaml`의 기본 ingress 차단과 `allow-menu-service`를 읽기 전용 확인했다.
  Menu:8080은 envoy-gateway-system·monitoring namespace와 같은 peakorder namespace의
  Order·Cooking·Inventory Pod에서 허용된다. NetworkPolicy는 HTTP 경로를 제한하지 않으므로
  이 허용 호출자는 actuator에도 접근할 수 있다. 서비스 자체에 별도 actuator 인증을 추가하지 않았다.
  저장소 정책 확인이며 현재 클러스터 적용/우회 차단의 실측 증거는 아니다.

## 산출물·보존·미검증·후속

실행 도구와 결과는 저장소 밖 `C:/M/Peak_Order-361-qa/`에 보관했다.
각 `run-*`에 `gradle.log`, `tests.json`, `runtime.json`, `prometheus.txt`,
`prometheus-after-gc.txt`, `application.log`가 있다. `verify.py`는 신규 격리 DB 생성부터
실행 JAR의 DB 중단/복구 및 종료까지 수행한 로컬 도구다. 비밀번호 파일은 초기화 직후 삭제한다.
제품 코드와 기존 테스트는 바꾸지 않고 마지막 검증 후 코드 동일성을 확인한다.
검증을 위해 시작한 PostgreSQL과 Java 프로세스만 종료한다.
기존 worktree·미추적 bin·미리보기 서버는 보존한다.

실제 클러스터·Gateway E2E·Prometheus scrape/up·ServiceMonitor·Grafana·Loki/ECS 출력,
Kubernetes probe/롤링·cgroup 제한은 미검증이다. #361 변경의 원격 CI와 외부 리뷰도 미수행이다.
이번 작업에서는 Commit·Push·PR 생성·Merge·배포·클러스터 리소스 변경을 하지 않는다.

후속 배포는 다음을 별도 검토한다.

1. #357/#360의 최종 병합 상태와 변경사항을 반영한 후 관리자 off/on 계약, 설정 보존, 전체 회귀를 재검증한다.
   담당자 외 리뷰와 CI를 완료하고 실제 새 이미지에 Actuator/registry가 포함됐는지 확인한다.
2. 별도 배포 PR에서 새 이미지 태그와 startup/liveness/readiness HTTP probe를 함께 검증한다.
   기본 readiness의 DB 제외 의미를 명시하고 DB 포함 여부를 담당자와 결정한다.
   ECS 로그는 그 배포의 `LOGGING_STRUCTURED_FORMAT_CONSOLE=ecs`로만 검토한다. 로컬 텍스트 로그는 유지한다.
3. #186 DB 연결 예산과 동시 롤링 제한, #280의 false 상태 선행 Gateway 검증·단계적 공개·롤백 절차를 따른다.
   Git PR → Argo CD로만 적용하고 실제 rollout/health/회귀 및 민감 로그 미노출을 확인한다.
4. 모니터링 담당과 별도 ServiceMonitor/additionalServiceMonitors 연결 및 Prometheus up,
   histogram/Hikari/JVM, Grafana·Loki를 검증한다. HPA와 공통 모니터링 설정은 별도 작업이다.
