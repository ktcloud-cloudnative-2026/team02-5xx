# Menu 관리자 인증 연동 — #280

## 확정 계약과 구현 상태

기준 main `843c95162daed7484f5bb54977c0a5ff8f92c211` (#356 병합 포함).
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
  HPA·자원·Hikari·종료 보호·모니터링·프론트엔드와 이미지 태그는 변경하지 않았다.

## 실제 적용 순서 — 자동 Sync에 주의

**dev overlay에 true가 들어 있으므로, 자동 Sync가 켜진 상태로 먼저 병합하면 안 된다.**
Kustomize는 Route·Policy·Deployment의 원자적 적용이나 정책 실제 준비 완료를 보장하지 않는다.
단순 sync-wave 순서만으로 Gateway 보호를 검증했다고 간주하지 않는다.
현재 클러스터·Application의 자동 Sync 상태는 이 작업에서 조회하지 않았다.

1. 서비스/Auth/Gateway/인프라 담당의 필수 리뷰·CI를 완료한다. GitOps 담당이 서비스 자동 Sync를
   일시 보류하거나 동등한 승인된 단계 적용 방법을 확보한다. 이를 준비하지 못하면 병합/활성화하지 않는다.
2. 새 정책 코드가 포함된 Menu 게시 이미지와 태그 변경을 별도 검토한다. 현재 dev 태그는
   `sha-eac2e88c7da2ed894689d4868713467c975ee3f4`로 이번 코드가 없는 과거 이미지다.
   이번 작업은 태그를 갱신하지 않으며, 설정만으로 새 구현이 배포됐다고 주장하지 않는다.
3. `MENU_ADMIN_ENABLED=false` 상태를 유지하면서 GitOps의 검토된 선택적 Sync 등으로
   관리자 Route/Policy를 먼저 적용한다. 필요한 경로만 공개하고 Policy target 일치,
   HTTPRoute Accepted/ResolvedRefs, SecurityPolicy Accepted 및 Envoy 실제 JWT 적용,
   NetworkPolicy 기본 차단·허용 목록과 Pod 생성 통제를 확인한다. 정책 리소스 존재만으로 완료하지 않는다.
4. 이 상태에서 무토큰·무효/위조/만료 JWT·무토큰 신원 위조는 Gateway 401임을 확인한다.
   정상 토큰은 아직 Menu 403이어도 차단 단계에서는 정상이다. 비허용 호출자의 직접 접근 차단,
   공개 조회·내부 호출 보존을 확인하고 기록한다. 증거가 없거나 실패하면 false 유지·경로 비공개로 복구한다.
5. 증거 및 담당자 승인 이후에만 코드가 포함된 이미지와 dev 활성화 패치를 Sync한다.
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
실제 dev E2E·배포·GitHub CI·외부 리뷰는 수행하지 않았고 #280 종료 조건은 아직 충족되지 않았다.
