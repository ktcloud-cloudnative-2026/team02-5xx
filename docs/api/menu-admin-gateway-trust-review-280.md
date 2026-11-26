# #280 사전 검토 이력과 A안 확정

## 현재 상태 (2026-11-25 합의 후 구현)

아래 원문은 **담당 합의 전 더 엄격한 요청별 Gateway 증명을 요구하던 시점**의 보류 기록이다.
당시 헤더만으로 Gateway 출처를 구분할 수 없다는 분석은 유지되지만, 그보다 강한 출처 인증을
이번 구현의 필수 조건으로 두지는 않는다. 갱신된 #280이 #112 A안의 수용 범위를 Menu에 적용했다.

- [Auth 동의](https://github.com/ktcloud-cloudnative-2026/team02-5xx/issues/280#issuecomment-7156615824),
  [Auth 현황 정정](https://github.com/ktcloud-cloudnative-2026/team02-5xx/issues/280#issuecomment-7156673885),
  [Gateway 동의](https://github.com/ktcloud-cloudnative-2026/team02-5xx/issues/280#issuecomment-7156749640),
  [Order 의견](https://github.com/ktcloud-cloudnative-2026/team02-5xx/issues/280#issuecomment-7156668619) 및
  [갱신된 Issue #280](https://github.com/ktcloud-cloudnative-2026/team02-5xx/issues/280)을 확인했다.
- PR #356은 main `b6bc0bb`로 병합됐다. 최초 구현 기준 main은 `843c95162daed7484f5bb54977c0a5ff8f92c211`이다.
  2026-11-26 통합 기준은 #357 병합을 포함한 `ca7c82b727c32677f5a11894bc844f3ee5fcaa0a`이며,
  자원·JVM·dev Hikari 4/1·종료 보호와 관리자 Route/Policy/활성화를 함께 보존한다.
- 제품 상시 false `AdminMenuGatewayTrust`를 기본 false `AdminMenuActivation`으로 교체했다.
  토글은 요청별 Gateway 검증이 아닌 배포 정책이다. true에서도 기존 ID·역할 검증은 생략하지 않는다.
- dev만 관리자 전용 Route·JWT Policy·활성화 패치를 두고 base/prod false와 공개 Route 제거 필터는 유지한다.
- 기존 8080·NetworkPolicy 허용 목록·Git PR → Argo CD 통제는 유지한다. 허용된 내부 호출자의
  헤더 위조와 노드 수준 위험을 수용하며, 이를 차단했다고 주장하지 않는다. 전용 포트·새 JWT 검증은 추가하지 않는다.
- 원문에서 제안한 관리자 전용 진입점 대안은 이번에는 채택하지 않았다.
- 현재 구현·테스트 구분·실제 활성화 전 게이트·실패 시 복구는
  [최신 인증 연동 문서](menu-admin-auth-integration.md)를 따른다. 실제 Gateway E2E와 배포는 미수행이다.

## 사전 검토 원문 — 이후 합의로 대체된 조건 포함

---

# #280 Menu 관리자 Gateway 신뢰 경계 사전 검토

확인일: 2026-11-25. 기준 main: `8c319af4abe5550ead0bf765b06e67a80dec85ac` (#340 병합 포함).
작업 브랜치: `feat/280-menu-admin-gateway-auth`. 기존 `C:/M/Peak_Order`를 재사용했으며 다른 worktree를 추가하지 않았다.

## 판단: 제품 연결은 추가 합의 전 보류

**현행 조건에서 검증된 Gateway 요청만 판별하는 구현을 확정할 수 없다.**
`AdminMenuGatewayTrust.isVerified()`의 상시 false와 ME-03~07 기본 403 차단을 유지한다. 제품 Java·Controller·업무 로직·DB·프론트엔드·배포 설정은 수정하지 않았다.
이 문서는 새 정책의 확정이나 관리자 활성화 승인이 아니라, #280 구현 전 확인 결과와 결정이 필요한 항목이다.

## 확인한 근거

- [#112 Gateway 최종 결정](https://github.com/ktcloud-cloudnative-2026/team02-5xx/issues/112#issuecomment-7094381845): Gateway JWT 검증 → sub/role 신원 헤더 → 서비스의 신원 형식/업무 권한 검사인 A안. 허용된 peakorder Pod의 직접 호출·신원 위조와 hostNetwork 등 노드 수준 우회는 NetworkPolicy 기본 차단, PR → Argo CD 배포, 관리자 기본 차단, 내부 경로 비노출을 전제로 수용한다.
- [#112 Auth 확인](https://github.com/ktcloud-cloudnative-2026/team02-5xx/issues/112#issuecomment-7095075470): 신원·오류 계약 수용과 구현/검증의 분리. 별도 서비스 JWT 검증·mTLS·서명 전달이 승인된 것은 아니다.
- [#112 변경 결정](https://github.com/ktcloud-cloudnative-2026/team02-5xx/issues/112#issuecomment-7151884786) 및 [#286 최종 dev 시험](https://github.com/ktcloud-cloudnative-2026/team02-5xx/issues/286#issuecomment-7151577491): JWT 보호 Route에서는 remove를 빼고 claimToHeaders의 덮어쓰기를 사용한다. remove가 주입 신원 헤더도 지운다는 실제 시험이 있다. 공개 Route의 remove는 유지한다.
- [#280](https://github.com/ktcloud-cloudnative-2026/team02-5xx/issues/280): 검증된 서버 신뢰 경계에만 연결하고, 단순 설정/역할 헤더로 허용하지 않으며 직접 호출 우회 방어와 보안 리뷰·실 Gateway E2E를 선행 조건으로 둔다.
- [PR #251](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/251): 관리자 업무 API 및 공통 정책 통합 완료, 제품 trust=false 유지로 승인됐다. Auth/Gateway 리뷰는 현재 차단 상태를 승인했으며 실제 Menu 활성화 방법을 확정하지 않았다.
- [PR #303](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/303): Order 고객 보호 경로의 JWT 설정 사례. Menu 관리자 경로·서비스 진입점 검증은 아니다.
- [PR #337 실제 dev 기록](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/337#issuecomment-7152089339): Inventory 무토큰/위조 헤더만/잘못된 토큰 401, CUSTOMER 403, 공개 IN-01 200을 보고했다. STORE_ADMIN 200은 당시 미검증이며 Menu의 Gateway 출처 판별을 입증하지 않는다. Inventory의 활성화 플래그와 헤더 검사를 그대로 복사하지 않는다.
- [PR #340](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/340): 관리자 프론트/역할 분리 및 ME-03~07 HTTP adapter는 main 병합됐다. 로컬 fixture·브라우저 성공은 실제 Menu 인증 성공 근거가 아니다.
- 저장소: [기존 Menu 통합 계약](menu-admin-auth-integration.md), [Auth 계약](auth-session-contract.md), [NetworkPolicy](../../deploy/platform/network-policies.yaml), [Menu 공개 HTTPRoute](../../deploy/apps/menu-service/base/httproute.yaml), 실제 trust/authorization/Controller 및 HTTP·DB 테스트를 대조했다.

## 판별할 수 없는 이유

`allow-menu-service`는 동일한 Menu Pod 8080에 Gateway namespace뿐 아니라 Order·Cooking·Inventory Pod와 monitoring namespace의 접근을 허용한다. Kubernetes NetworkPolicy의 이 규칙은 URL별 관리자/내부/모니터링 경로를 구분하지 않는다. 허용된 호출자는 그 포트에서 `/api/v1/admin/menus`와 신원 헤더를 보낼 수 있다.

현재 Menu에는 Gateway가 검증했다는 서버 측 인증 결과/검증된 주체를 전달하는 별도 연결이 없다. `X-User-*`, Bearer 문자열 존재, Servlet principal/role, ClusterIP, 활성화 플래그만으로는 출처가 검증되지 않는다. 이 조건을 true로 바꾸는 것은 신뢰 판별의 구현이 아니라 현재의 명시적 차단을 완화하는 변경이다.

#112의 내부 침해 위험 수용이 잘못됐다는 판단은 아니다. 다만 그 수용 범위와 #280의 더 엄격한 직접 호출 방어 조건을 같은 것으로 취급할 수 없다. monitoring namespace의 모든 허용 Pod까지 수용 대상인지도 #112의 peakorder 내부 Pod 수용 문구만으로 확정할 수 없다. 노드 수준 우회까지 이번 변경으로 해결했다고 주장하지 않는다.

## 결정이 필요한 대안

### A. #280의 엄격한 경계를 유지: Gateway 전용 관리자 진입점 합의

A안 JWT 검증 위치는 그대로 두고, 관리자 요청을 Gateway만 도달할 수 있는 별도 listener/포트 등으로 분리하는 설계를 Auth·Gateway·Menu·네트워크 담당이 검토한다. 기존 Order/Cooking/Inventory 내부 호출과 monitoring은 기존 포트를 유지한다.

합의 시 최소 확인 항목:

1. 관리자 전용 진입점의 네트워크 허용 범위와 Gateway Pod 식별, 기존 포트에서 관리자 업무가 계속 차단되는 서비스 정책.
2. 신뢰 판별에서 사용할 서버 측 진입점 증거와 fail-closed 동작. 설정값이나 헤더 하나만으로 허용하지 않음.
3. 공개 ME-01·02, 내부 MI-01·02, monitoring과 기존 호출자의 무중단 유지.
4. Gateway JWT 보호 Route의 remove 없음 + claim 덮어쓰기, 공개 Route의 remove 유지.
5. NetworkPolicy·Service·listener·HTTPRoute·SecurityPolicy 적용 순서, 동시 버전 호환, 실패 시 차단 복구 및 담당자 리뷰.
6. 실제 Gateway 관리자 성공/오류, 내부 허용 Pod에서 관리자 진입점/기존 포트 우회 실패 확인. 현재 관리 namespace 전체 허용이 충분한지도 검토.

이 대안도 아직 설계가 확정되거나 배포 검증된 것은 아니다. 이번 요청의 인프라 변경 제외 조건에 따라 설정·코드는 만들지 않았다.

### B. 현행 단일 포트의 #112 잔여 위험을 #280에도 수용할지 명시적 재합의

허용된 내부 호출자가 관리자 헤더를 위조할 수 있음을 남기는 방식은 엄격한 Gateway 출처 판별과 다르다. 이를 택하려면 #280의 우회 방어 조건 및 이번 작업의 허용 조건 변경을 명시적으로 합의해야 한다. 현재 요구사항으로는 구현하지 않는다.

서비스 JWT 재검증, mTLS, 서명된 신원 전달은 별도 아키텍처 결정이며 이번에 추가하지 않는다.

## 실제 검증과 미검증

### 이번 로컬 기준 회귀

Java 21, 기존 Gradle 8.14.3 및 기존 테스트를 사용했다. 별도 PostgreSQL 18 data 디렉터리·전용 테스트 역할/DB·loopback 55480을 만들었으며 기존 공유/서비스 DB를 사용하지 않았다. 임시 DB는 loopback trust 인증이며 운영 설정이나 인증 자격증명이 아니다.

```powershell
# 별도 폐기 가능한 테스트 DB 환경 변수를 설정한 프로세스에서 실행
.\gradlew.bat --no-daemon spotlessCheck test build --rerun-tasks --console=plain
```

- JUnit XML: **534 PASS, 실패 0, 오류 0, 생략 0**.
- 실제 PostgreSQL **91건 포함**: MenuDatabaseTests 36, 관리자 조회 13, 등록 6, 수정 12, 판매 상태 18, 통합 HTTP/DB 6.
- 기본 차단, 임의 헤더/Bearer/Servlet 신원 거부, 단일·중복·대소문자 이름·콤마 결합·잘못된 ID/역할·CUSTOMER 403 및 모의 신뢰 경계에서 STORE_ADMIN 정책을 기존 테스트로 확인했다.
- 실제 Controller→업무→PostgreSQL ME-03~07 조합과 권한 실패 시 DB 변경 없음, ME-01·02 및 MI-01·02 회귀도 포함한다.
- `test`, `spotlessCheck`, `build` 모두 PASS. 테스트/설정/조건을 삭제하거나 완화하지 않았다.
- Flyway V1 성공, 종료 후 categories/menus/menu_options 모두 0행 확인. 이번에 시작한 임시 PostgreSQL만 종료했다.
- 테스트 로그·JUnit 합계는 저장소 밖 `C:/M/Peak_Order-280-qa/gradle.log`, `test-summary.json`에 보관했다.

관리자 정상 HTTP/DB 테스트는 **Gateway 신뢰 판정만 테스트에서 모의한 것**이다. 실제 JWT 서명 검증·Gateway 출처 인증·서비스 공개 성공을 뜻하지 않는다.

### 기존 기록에서 확인한 것과 남은 것

| 항목                                           | 확인 범위                                                                                 |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 정상·누락·형식 오류·서명 변조·만료 토큰        | #286 Order 경로 dev 시험 기록 있음; 이번에 재실행하지 않음                                |
| 정상 CUSTOMER 토큰 + 위조 신원                 | #286 Order dev에서 claim 덮어쓰기 보고                                                    |
| issuer/audience/JWKS 설정                      | 기존 SecurityPolicy 계약과 일치; 회전·장애 및 개별 거부 시험 완료 근거는 검토 자료에 없음 |
| role 없는 유효 서명 토큰 + 위조 헤더           | #286·#337에서 미검증으로 명시                                                             |
| Menu JWT Route와 중복/대소문자/콤마 위조       | 실제 Menu Gateway 시험 없음; 서비스 정책 모의 테스트와 구분                               |
| Menu 정상 STORE_ADMIN·CUSTOMER·우회 차단       | 실제 dev Gateway E2E 미수행, 관리자 Route 비공개·제품 403 유지                            |
| NetworkPolicy/RBAC/PR→Argo CD 제약의 현장 상태 | 저장소 설정 검토만 수행; 현재 클러스터에서 확인하지 않음                                  |

## 최종 작업 범위

이번 변경은 이 사전 검토 문서 1파일뿐이다. 제품 신뢰 경계 연결, 새로운 업무 기능, 프론트엔드, Gateway/NetworkPolicy·배포 설정은 변경하지 않았다. 기존 worktree·미추적 bin 디렉터리·미리보기 서버를 보존한다.

**구현 재개 조건:** 위 대안의 신뢰 수준·진입점 및 허용 위험 범위를 담당자가 합의하고, 필요한 인프라·서비스 변경/검증 범위를 승인한다. 그 전에는 기본 차단을 유지한다. Commit·Push·PR 생성·병합을 하지 않는다.
