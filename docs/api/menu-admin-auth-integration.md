# Menu 관리자 인증 연동 — #280

## 확정 계약과 구현 상태

최초 구현 기준 main `843c95162daed7484f5bb54977c0a5ff8f92c211` (#356 병합 포함).
현재 통합 기준 main `ca7c82b727c32677f5a11894bc844f3ee5fcaa0a`는 #357의 Menu 자원·JVM·
dev Hikari 4/1·종료 보호를 포함한다. 기존 관리자 인증 설계/Java 코드는 바꾸지 않는다.
[#112](https://github.com/ktcloud-cloudnative-2026/team02-5xx/issues/112)의 A안은
Gateway JWT 검증 → 신원 헤더 전달 → 서비스의 신원 형식/역할 검사다.
[갱신된 #280](https://github.com/ktcloud-cloudnative-2026/team02-5xx/issues/280),
[Auth 동의](https://github.com/ktcloud-cloudnative-2026/team02-5xx/issues/280#issuecomment-7156615824),
[Gateway 동의](https://github.com/ktcloud-cloudnative-2026/team02-5xx/issues/280#issuecomment-7156749640),
[Order 의견](https://github.com/ktcloud-cloudnative-2026/team02-5xx/issues/280#issuecomment-7156668619)을
근거로 기존 요청별 Gateway 증명 요구 대신 명시적 서비스 활성화 정책을 구현했다.

- `AdminMenuGatewayTrust.isVerified()`를 제거하고 `AdminMenuActivation.isEnabled()`를 사용한다.
- `menu.admin.enabled=${MENU_ADMIN_ENABLED:false}`: 미설정/false는 기존 403 차단.
  해석할 수 없는 값은 시작 실패로 차단한다. 활성화는 배포 정책이며 JWT 인증 증거가 아니다.
- 활성화 시 기존 `AdminMenuAuthorization.requireStoreAdmin()`이 신원 검증을 수행한다.
  모든 ME-03~07 Controller는 ID 변환·본문 파싱·Service 호출 전에 이를 실행한다.
- ID/역할 각각 정확히 1개, 비어 있거나 중복·콤마 결합·잘못된 값이면 401 UNAUTHORIZED.
  ID는 선행 0 없는 ASCII 양의 Long(`[1-9][0-9]*`)이다. 헤더 이름은 HTTP 규칙대로
  대소문자를 구분하지 않으며, 값은 추정·정규화하지 않는다.
- 역할 값은 CUSTOMER/STORE_ADMIN만 허용하며 CUSTOMER는 403, STORE_ADMIN은 업무에 진입한다.
  토글 off는 이 검사 전 403이다. 임의 Bearer·Servlet principal/role만으로 통과하지 않는다.
- DTO·Service·Repository·스키마·오류 응답 계약은 유지한다. OpenAPI 설명만
  기존 상시 차단에서 기본 차단/활성화 시 권한 검사로 맞췄다.

## 보안 경계와 수용한 위험

서비스는 JWT를 재검증하거나 요청별 Gateway 출처를 식별하지 않는다.
같은 8080에 허용된 Order·Cooking·Inventory·monitoring/Gateway 접근과
NetworkPolicy 기본 차단·허용 목록, Pod 생성의 Git PR → Argo CD 통제를 전제로 한다.
허용된 내부 호출자의 헤더 사칭과 hostNetwork 등 노드 수준 우회는 #112/#280에서 수용한
잔여 위험이며 차단 성공으로 기록하지 않는다. 토글 true + 올바른 헤더 자체는
Gateway가 인증했다는 증거가 아니다. mTLS·서명 전달·별도 JWT 검증·전용 포트는 도입하지 않았다.

Gateway 토큰 누락/검증 실패는 401이고 본문은 text/plain일 수 있다.
서비스 신원 오류는 공통 JSON 401, 역할 부족/비활성화는 JSON 403이다.
[11/25 헤더 처리 변경](https://github.com/ktcloud-cloudnative-2026/team02-5xx/issues/112#issuecomment-7151884786)에
따라 JWT Route에는 RequestHeaderModifier(remove)를 두지 않는다.
claimToHeaders가 클라이언트 값을 검증된 sub/role로 덮어쓴다. 공개 Route는 remove를 유지한다.

사전 검토의 더 엄격한 조건으로 보류했던 이유와 원문은
[사전 검토/합의 이력](menu-admin-gateway-trust-review-280.md)에 보존했다.
Auth 공통 계약은 병합된 [#356](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/356)과
[auth-session-contract.md](auth-session-contract.md)를 따른다. 다른 서비스의 당시 적용 상태와
Menu 자체 검증 완료 여부는 구분한다.

## dev/prod 배포 구성

- base Deployment는 `MENU_ADMIN_ENABLED=false`; prod도 false를 유지하며 관리자 Route/Policy가 없다.
- dev만 `admin-enabled-patch.yaml` true, `menu-service-admin` HTTPRoute,
  `menu-service-admin-jwt` SecurityPolicy를 정의한다. 이 파일을 실제 적용한 것은 아니다.
- Controller와 동일한 5개 operation만 공개한다: GET/POST `/api/v1/admin/menus`,
  GET/PATCH `/api/v1/admin/menus/{menuId}`, PATCH `/api/v1/admin/menus/{menuId}/status`.
  단일 세그먼트 regex로 ID의 기존 400 계약을 유지하며 추가 하위 경로와 다른 메서드는 열지 않는다.
- JWT provider는 최신 Order dev SecurityPolicy와 같은 issuer/audience/remoteJWKS와
  sub→X-User-Id, role→X-User-Role을 쓴다. 환경 도메인이 바뀌면 관련 서비스와 함께 검토해야 한다.
- 공개 ME-01/02 Route, Service, 포트, NetworkPolicy, 내부 MI-01/02 관계는 변경하지 않았다.
  현재 통합 결과는 병합된 #357의 자원·JVM·dev Hikari 4/1·종료 보호를 보존한다.
  Menu HPA·Application replicas 비교 제외·#365 Actuator/Prometheus는 추가하지 않았다.
  미병합 자동 태그 PR은 가져오지 않고 최신 main의 Menu 태그를 유지한다.

## 실제 적용 순서 — 자동 Sync에 주의

**Gateway 보호를 검증하기 전에 새 관리자 구현이 담긴 이미지를 활성화하지 않는다.**
Kustomize는 Route·Policy·Deployment의 원자적 적용이나 정책 실제 준비 완료를 보장하지 않는다.
단순 sync-wave 순서만으로 Gateway 보호를 검증했다고 간주하지 않는다.
현재 클러스터·Application의 자동 Sync 상태는 이 작업에서 조회하지 않았다.

GitOps 담당은 PR #360 리뷰에서 구 이미지 차단을 이용한 단계 적용을 제안했다.
자동 Sync 중단만을 유일한 방법으로 고정하지 않되, 구 이미지의 실제 차단 상태 또는
명시적 off 상태를 담당자가 확인한 뒤 Gateway/NetworkPolicy를 먼저 검증한다.
리뷰의 "구 이미지에 상시 false trust가 있다"는 설명과 달리, 현재 `eac2e88…` 게시 JAR에는
관리자 컨트롤러와 trust/activation 클래스가 없다. 이전 main 소스의 상시 false/403과
이 게시 이미지의 엔드포인트 부재를 구분하며, 새 태그 PR 반영 전에 다시 확인한다.

1. 서비스/Auth/Gateway/인프라 담당의 필수 리뷰·CI를 완료한다. GitOps 담당이 구 이미지 차단을
   확인한 단계 적용, 명시적 off 또는 자동 Sync 조율 중 승인된 방법을 확보한다.
   차단 상태를 확인하지 못하면 새 이미지 공개/활성화를 진행하지 않는다.
2. 새 정책 코드가 포함된 Menu 게시 이미지와 태그 변경을 별도 검토한다. 현재 dev 태그는
   `sha-eac2e88c7da2ed894689d4868713467c975ee3f4`로 이번 코드가 없는 과거 이미지다.
   이번 작업은 태그를 갱신하지 않으며, 설정만으로 새 구현이 배포됐다고 주장하지 않는다.
3. 구 이미지의 관리자 미제공 또는 새 코드의 `MENU_ADMIN_ENABLED=false` 상태를 유지하면서
   GitOps의 검토된 단계 Sync 등으로
   관리자 Route/Policy를 먼저 적용한다. 필요한 경로만 공개하고 Policy target 일치,
   HTTPRoute Accepted/ResolvedRefs, SecurityPolicy Accepted 및 Envoy 실제 JWT 적용,
   NetworkPolicy 기본 차단·허용 목록과 Pod 생성 통제를 확인한다. 정책 리소스 존재만으로 완료하지 않는다.
4. 이 상태에서 무토큰·무효/위조/만료 JWT·무토큰 신원 위조는 Gateway 401임을 확인한다.
   정상 토큰이어도 구 이미지의 관리자 미존재 응답 또는 새 코드의 off 403은 차단 단계에서 정상이다.
   비허용 호출자의 직접 접근 차단,
   공개 조회·내부 호출 보존을 확인하고 기록한다. 증거가 없거나 실패하면 false 유지·경로 비공개로 복구한다.
5. 증거 및 담당자 승인 이후에만 코드가 포함된 이미지로 전환해 dev 활성화를 허용한다.
   STORE_ADMIN의 ME-03~07, CUSTOMER 및 CUSTOMER+위조 관리자 헤더 403, 신원 오류,
   중복/대소문자/콤마 처리, 고객/내부 회귀를 실제 Gateway에서 재검증한다.
6. 정상/오류 결과와 JWKS 취득·회전·장애 중 확인한 범위/미검증을 #280에 기록한다.
   토큰·비밀번호는 로그에 남기지 않는다. 확인 후 승인된 자동 Sync 운영을 복구한다.

### 실패 시 복구

업무 접근에 문제가 있으면 먼저 GitOps에서 `MENU_ADMIN_ENABLED=false`를 적용해
Menu 403 차단과 진행 중 롤링의 완료를 확인한다. 긴급 조치는 팀의 승인된 운영 절차를 따른다.
그다음 관리자 HTTPRoute를 비공개로 하고 Policy를 정리하거나 알려진 안전 버전으로 함께 롤백한다.
**활성 서비스와 공개 Route를 남긴 채 JWT Policy부터 제거하지 않는다.**
공개/내부 경로·Secret·포트·NetworkPolicy 및 prod 차단은 유지한다.

## 로컬 검증과 한계

검증 명령은 Menu 디렉터리에서 별도 폐기 가능한 PostgreSQL 테스트 환경 변수를 지정해 실행한다.

```powershell
.\gradlew.bat --no-daemon spotlessApply spotlessCheck test build --rerun-tasks --console=plain
kustomize build deploy/apps/menu-service/overlays/dev
kustomize build deploy/apps/menu-service/overlays/prod
git diff --check
```

로컬 신원 헤더 주입은 실제 Gateway JWT 인증 검증이 아니다.
기존 관리자 통합 HTTP/DB 정상 경로는 실제 활성화 property로 만든 Bean을 통과한다.
동일 테스트의 off 복구만 spy로 전환하며, 정책/MockMvc 테스트와 업무 단위 테스트의
모의 구현은 제품 코드/배포 환경으로 제공하지 않는다. 기본값·false·true·잘못된 환경 변수는
Spring 컨텍스트 테스트로 따로 검증한다.

최종 JUnit XML 합산: **611 PASS, 실패/오류/생략 0**, 이전 534 대비 **+77**.
추가 77건은 활성화 환경 설정 5, 관리자 5개 operation × 14개 거부 입력 70,
헤더 이름 대소문자 허용/정형 값 유지 2건이다. 기존 테스트는 삭제하지 않았다.
실제 별도 PostgreSQL 18의 DB 테스트 **91건**도 포함한다. 통합 ME-03~07 CRUD/옵션/상태,
권한 실패 시 DB 변경 없음과 ME-01/02·MI-01/02 회귀가 포함된다.
`test`, `spotlessCheck`, `build` 및 문서/YAML Prettier, diff 검사를 통과했다.

Kustomize v5.8.3 dev/prod 렌더링 PASS: dev 리소스 5개(관리자 Route/Policy 포함)·true,
prod 3개·false. 새 토글 외 기존 Deployment와 공개 Route/Service 객체는 동일하다.
Route의 5개 method/path와 추가 메서드·하위 경로 비노출, Policy target 일치,
Order와 JWT provider 완전 일치, 환경 변수 중복 없음 및 Secret/probe/태그 보존을 검사했다.

검증 전용 DB는 loopback 별도 data/role/DB를 사용했고 업무 테이블 0행을 확인한 뒤
이번에 시작한 서버만 종료한다. 산출물은 저장소 밖
`C:/M/Peak_Order-280-implementation-qa/`의 `gradle-final.log`, `test-results.json`,
`manifest-results.json`과 before/after YAML이다. 사전 검토 원본도 이 경로에 따로 보관했다.
위 수치는 최초 #280 로컬 검증 기록이다. 이후 PR #360의 CI Final SUCCESS와 Auth/GitOps·인프라
담당 APPROVED 리뷰를 확인했다. 이번 미커밋 통합의 원격 CI는 아직 실행되지 않았다.
실제 dev E2E·배포는 수행하지 않았고 #280 종료 조건은 아직 충족되지 않았다.

## #357 병합 후 #360 통합 검증 (2026-11-26)

통합 main은 `ca7c82b727c32677f5a11894bc844f3ee5fcaa0a`, 기존 HEAD는
`a87d73e8026c0602c6697be2dc6019d4aa7b10a6`이다. 로컬 `merge --no-commit --no-ff` 상태에서
`deploy/apps/menu-service/README.md`와 dev `kustomization.yaml`의 충돌을 해결했다.
README는 #280과 #354/#357의 설명을 모두 보존하고 최초 검증과 이번 통합 검증을 구분했다.

dev에는 관리자 HTTPRoute/SecurityPolicy와 Hikari patch/관리자 활성화 patch를 함께 연결한다.
이미지는 main의 `sha-eac2e88c7da2ed894689d4868713467c975ee3f4`를 유지한다.
CPU requests/limits 100m/1, 메모리 384Mi/768Mi, JVM MaxRAMPercentage 60.0,
dev Hikari maximum/minimum idle 4/1, preStop 10초, 종료 유예 50초를 보존했다.
prod는 관리자 false·관리자 Route/Policy 없음·Hikari 크기 미지정 상태를 유지한다.

### 구성 비교

- Kustomize v5.8.3으로 최신 main과 통합 결과의 base/dev/prod 6개 렌더링을 비교했다.
  base 3개/false, dev 5개/true, prod 3개/false다. 환경 변수 이름 중복은 없다.
- 관리자 토글과 dev의 관리자 Route/Policy를 제외하면 기존 객체가 main과 전체 동일하다.
  자원/JVM/종료/Hikari·Secret·TCP probe·이미지·포트·selector/labels·고객 Route/Service가 보존된다.
  dev JWT provider는 현재 Order 설정과 동일하고 5개 operation 및 Policy target도 일치한다.
- NetworkPolicy와 Menu Application 파일은 main과 동일하다. Menu HPA 및 Application replicas
  비교 제외를 추가하지 않았다. 미병합 #365와 자동 이미지 태그 PR을 가져오지 않았다.
  `build.gradle`, 애플리케이션 properties, Java와 기존 테스트는 HEAD와 동일하다.
  새 JAR에 Actuator/Prometheus registry가 없고 `/actuator/prometheus`도 404다.

### 애플리케이션과 실제 환경 변수

Java 21.0.7/Gradle Wrapper 8.14.3으로 격리 PostgreSQL 18 테스트 DB를 지정하고
`spotlessCheck test build --rerun-tasks --no-daemon --console=plain`을 실행했다.
**611 PASS, 실패/오류/생략 0**, 실제 PostgreSQL **91건**이다.
기존 ME-03~07의 CRUD/옵션/상태 및 권한 선검사, 기본값/false/true/잘못된 설정,
신원/역할 오류, 고객 ME-01/02 및 내부 MI-01/02 회귀가 포함된다.

별도 runtime DB와 loopback 임시 HTTP 포트에서 실행 JAR도 검증했다.
배포와 같은 환경 변수 이름으로 Hikari 4/1 및 `JAVA_TOOL_OPTIONS=-XX:MaxRAMPercentage=60.0`을 주입했다.
테스트 전용 Hikari DEBUG 로그의 바인딩 값과 `jcmd VM.flags`를 확인했다.
최대 4/최소 유휴 1과 MaxRAMPercentage 60.0이 관리자 off/on 모두 유지됐고,
관찰 시점의 실제 DB 연결 수는 off 3개/on 2개로 최대값 안이었다. minimum idle은 총 연결 수의 고정값이 아니다.
테스트 비밀번호의 로그 미노출도 확인했다.

| 로컬 실제 HTTP                     | 통합 새 코드 off | 통합 새 코드 on             | 현재 게시 구 JAR, 토글 true |
| ---------------------------------- | ---------------- | --------------------------- | --------------------------- |
| 관리자 5개 operation, 신원 누락    | 모두 403         | 모두 401                    | 모두 404                    |
| 같은 operation, CUSTOMER           | 모두 403         | 모두 403                    | 모두 404                    |
| 정상 STORE_ADMIN, 목록/상세 GET    | 403              | 200                         | 404                         |
| 정상 STORE_ADMIN, 잘못된 JSON 쓰기 | 403              | 400(권한 통과 후 파싱 거부) | 404                         |
| 정형이 아닌 ID `007`               | 403              | 401                         | 404                         |
| 고객 목록/상세·내부 존재/구매 검증 | 200              | 200                         | 200                         |

쓰기 정상 CRUD는 위 611건의 실제 HTTP/PostgreSQL 통합 테스트에서 검증했다.
로컬 신원 헤더 입력은 실제 JWT/Gateway 인증 성공을 의미하지 않는다.

### 구 이미지의 실제 차단 원인

현재 GHCR tag의 linux/amd64 manifest는
`sha256:b17ebd251d5fa3dff8c534baab3458478b4508e3382883dd090e5062b602922f`다.
registry manifest가 보관한 값과 같고, layer digest 및 `/app/app.jar` SHA-256 일치를 확인했다.
게시 JAR의 SHA-256은 `9dc251e310161ca2e591caf299a867a239f943fb996be7472ef46e17fff0be7b`다.
이 JAR에는 관리자 Controller·`AdminMenuGatewayTrust`·`AdminMenuActivation` 및 활성화 property가 없다.
실제 실행에서 `MENU_ADMIN_ENABLED=true`와 올바른 관리자 헤더를 줘도 5개 operation은 모두 404였다.
따라서 현재 구 이미지에서 관리자 기능이 열리지 않는 전제는 유지되지만,
"구 이미지가 상시 false trust를 거쳐 403"이라는 설명은 이 태그의 실물과 맞지 않아 정정했다.
이전 main 소스의 default-deny 403 회귀와 구 이미지의 관리자 경로 부재를 구분한다.
새 태그를 적용하기 전에는 구 이미지 차단에 의존하는 단계가 여전히 유효한지 재확인해야 한다.

### 산출물과 한계

기존 QA 산출물 폴더는 Git worktree가 아니며, 기존 브랜치는 원래 체크아웃 위치에서 유지했다.
새 자료는 기존 산출물을 덮어쓰지 않고 별도 `<qa-dir>/integration-360/` 하위에 보관했다.
`manifest-results.json`, before/after YAML, registry manifest 확인 결과,
`run-*/tests.json`, `gradle.log`, `runtime-results.json`, 구 이미지 내용 목록 및 실행 로그가 있다.
전체 Gradle 성공 뒤의 보조 실행 검사에서는 구 이미지에 대한 잘못된 클래스 가정과
검증용 로그 수준 설정을 고쳐 재실행했다. 최종 런타임 결과는 별도 성공 실행에 기록했다.
공유 DB는 사용하지 않았고, 테스트용 비밀번호는 무작위 생성해 환경 변수로만 전달했다.
이번 검증 전용 PostgreSQL과 JVM만 종료했다. 기존 worktree·bin·서버는 보존한다.

실제 Kubernetes 자원 제한·preStop 실행·종료 시간·Argo CD Sync/롤링·현재 NetworkPolicy 적용 상태,
실제 JWT·JWKS·Gateway E2E 및 dev DB 연결 수는 이번에 직접 검증하지 않았다.
새 관리자 이미지 게시와 단계 적용/복구 절차는 위 게이트를 따른다.
Commit·Push·PR 병합·배포·클러스터 변경은 수행하지 않고 병합 해결 상태만 남긴다.
