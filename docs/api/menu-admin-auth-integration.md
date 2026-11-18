# Issue #108 실제 관리자 인증 연동 점검·결정 요청

확인일: 2026-11-18. 작업 HEAD `fb142b9`, fetch 후 origin/main `2847b18`.
그 사이 main 변경은 CLAUDE.md의 작업 전 GitHub 점검 절차이며 Auth/Gateway 기능 추가가 아닙니다.
기존 미커밋 관리자 조회 코드를 보존하고 브랜치 전환·통합 없이 확인했습니다.

**실제 STORE_ADMIN 인증 연동은 미완료입니다. 아래 권장안은 팀 승인 전이며 구현된 계약이 아닙니다.**

## 확인된 코드·설계와 빠진 부분

| 영역 | 실제 확인 내용 | 근거·외부 의존성 |
| --- | --- | --- |
| Auth API | 회원가입·이메일 중복 확인만 존재. 로그인·토큰 발급·refresh/logout·JWKS/introspection 구현 없음 | [RegistrationController](../../services/auth-service/src/main/java/com/peakorder/auth/controller/RegistrationController.java), [병합된 PR #96](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/96) |
| Auth 보안 의존성 | spring-security-crypto와 Bouncy Castle은 비밀번호 해시용. JWT verifier/filter 체계가 아님 | [build.gradle](../../services/auth-service/build.gradle), [PasswordConfiguration](../../services/auth-service/src/main/java/com/peakorder/auth/config/PasswordConfiguration.java) |
| 사용자 역할 | UserRole에 CUSTOMER·STORE_ADMIN이 있으나 공개 가입은 CUSTOMER/ACTIVE로 고정. 관리자 계정 개설·로그인·역할 변경 흐름은 확인되지 않음 | [User](../../services/auth-service/src/main/java/com/peakorder/auth/entity/User.java), [가입 설계](auth-registration-design.md)의 로그인 항목도 제안 상태 |
| Gateway | GatewayClass 및 HTTP 포트 80 리스너, 허용 route namespace만 선언 | [gateway.yaml](../../deploy/platform/gateway.yaml) |
| Gateway 인증 | main에 JWT SecurityPolicy·인증 연동 HTTPRoute·검증 후 사용자/역할 전달·신뢰 헤더 제거 정책 없음 | main의 deploy 파일 목록·gateway.yaml 대조. 실제 클러스터 설정은 이번에 조회하지 않았으므로 런타임 존재 여부는 단정하지 않음 |
| Menu 배포 | main에 Menu Service 배포 매니페스트 없음. PR #85는 미병합 | [PR #85](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/85). ClusterIP·내부 서비스라는 설명만으로 인증된 Gateway 경로가 입증되지 않음 |
| 사용자 전달 | X-User-Id는 Order의 임시 방식이며 X-User-Role의 신뢰 가능한 전달 계약 미확정 | [API 초안](notion-draft.md), [PR #78 팀 결정 요청](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/78) |
| 팀 결정 | PR #78은 Gateway 검증·신원 헤더 제거/재작성·서비스 역할 확인·직접 접근 제한을 제안 중. 확인한 본문/리뷰에 채택 근거 없음 | [Cooking #99](https://github.com/ktcloud-cloudnative-2026/team02-5xx/issues/99)도 같은 결정을 선행 조건으로 명시 |
| Notion | API 초안은 AU-01과 STORE_ADMIN 권한을 정의하지만 토큰 claim·검증 위치·헤더 신뢰 계약은 확정하지 않음 | [API 초안](https://app.notion.com/p/4102f07e9478802f91a4da2ae18ab56f), [설계 결정 기록](https://app.notion.com/p/40f2f07e947880e79b0bd511e54367a5) |
| 현재 Menu | 관리자 Controller는 기존 조회 Service를 사용하나 AdminMenuAuthorization은 실제 실행에서 항상 403으로 거부 | [AdminMenuAuthorization](../../services/menu-service/src/main/java/com/peakorder/menu/service/AdminMenuAuthorization.java). 모의 권한 허용 테스트는 실제 인증 증거가 아님 |

main·관련 공개 PR/Issue와 연결된 Notion 자료의 확인 범위 내 결과입니다.
저장소 밖의 미공유 구현·운영 Secret·클러스터 정책은 확인하지 않았습니다.
Auth의 비밀번호 해시나 DB role 컬럼만으로 JWT 검증·관리자 신원 확인을 대체할 수 없습니다.
Menu에서 Auth DB를 직접 조회하거나 비밀번호를 검증하는 방식은 서비스 데이터 소유권 규칙에 맞지 않아 추가하지 않습니다.

## 담당자가 확정해야 할 결정

담당자는 [역할표](../roles.md) 기준입니다. 이 문서를 작성했다고 담당자에게 메시지를 보낸 것은 아닙니다.

| 결정 | 주 담당 | 권장안·확정할 산출물 |
| --- | --- | --- |
| 실제 AU-01 및 관리자 계정 | Auth @lth1202 | ACTIVE 계정의 비밀번호 검증 후 토큰 발급. 관리자 계정 개설은 제한된 절차로 정하고 공개 가입에 role 입력을 허용하지 않음. 실제 테스트 관리자 계정 준비 |
| 토큰 계약 | Auth + Gateway @jjh970830-beep + 서비스 담당 | 승인된 서명 알고리즘/키 관리, issuer·audience·subject의 의미와 타입, 단일 role 또는 roles 구조, 만료·nbf·키 회전·폐기 정책. 값·claim 이름·유효시간은 이 문서에서 확정하지 않음 |
| JWT 검증 위치 | Gateway + Auth + 서비스 담당 | 아래 A/B안을 비교해 PR #78의 공통 결정을 확정. Menu만의 임시 헤더 계약을 만들지 않음 |
| MSA 전달·직접 접근 방지 | Gateway·네트워크 @jjh970830-beep | 외부 신원 헤더 제거, 검증된 신원 전달의 무결성, direct Service 호출·내부 MSA에서 관리자 경로 우회 방지, 외부 /internal/v1 차단을 함께 검증 |
| 경로별 정책 | Gateway + Menu @MyaNiss | 고객 ME-01·02는 비회원 허용, 관리자 ME-03·04는 검증된 STORE_ADMIN만 허용. Swagger·health 및 내부 서비스 호출의 별도 범위 결정 |
| 오류 계약 | Auth + Gateway + 서비스 담당 | 권장: 미인증·만료·변조/검증 실패는 401, 유효 신원의 역할 부족은 403. 키 조회 장애 등 인프라 오류의 status/errorCode는 별도 합의. Gateway 오류도 success/data/message/errorCode 규칙 유지 |
| 의존성·인프라 승인 | 관련 담당 및 작성자 외 리뷰어 | Menu JWT verifier를 도입한다면 기존 Boot BOM에 맞는 검증 라이브러리/설정의 사전 승인. Gateway CRD·TLS·NetworkPolicy 변경은 해당 담당 범위의 별도 작업 |

### 검증 위치 비교와 권장 방향

**권장 검토안 A: Auth가 서명한 토큰을 Gateway와 Menu가 각각 검증.**
Gateway에서 외부 인증을 수행하되, Menu도 원본 토큰의 서명·issuer·audience·시간·역할을
승인된 검증기로 확인하여 직접 호출이나 내부 요청의 헤더 위조에 의존하지 않는 방향을 권장합니다.
비대칭 서명·공개키/JWKS 전달 방식을 검토하면 Menu에 Auth의 토큰 서명 비밀키를 공유하지 않을 수 있습니다.
다만 현재 없는 라이브러리·키·claim·필터 체계가 필요하므로 CLAUDE.md 0.4에 따른 사전 합의 전에는 구현하지 않습니다.
Spring Security의 JWT Resource Server는 서명과 issuer·시간 검증 및 audience 검증 구성을 제공하지만
현재 Menu에 설치된 기능이 아닙니다. [공식 문서](https://docs.spring.io/spring-security/reference/servlet/oauth2/resource-server/jwt.html).

**대안 B: PR #78의 Gateway 단독 검증 및 신원 전달.**
서비스 의존성을 줄일 수 있지만, 전달 헤더는 검증된 프록시 경로에서만 생성·신뢰되도록 해야 합니다.
ClusterIP만으로 그 신뢰가 성립하지 않으며, 다른 내부 MSA도 Menu의 MI-01·MI-02를 호출하므로
공유 포트에 대한 단순 네트워크 허용만으로 관리자 경로의 신원 헤더 신뢰를 보장할 수 없습니다.
신뢰 가능한 Gateway→Menu 연결이나 서명된 신원 전달, 내부/외부 경로 분리 등 우회 방지 설계를
Gateway/네트워크 담당자가 제시·검증해야 합니다. 구체 프로토콜을 이 작업에서 임의 선택하지 않습니다.
Envoy Gateway에는 SecurityPolicy JWT 기능이 있으나 실제 설치 버전·CRD·인증 정책 적용을 먼저 확인해야 합니다.
[공식 JWT 문서](https://gateway.envoyproxy.io/docs/tasks/security/jwt-authentication/).

어느 안이든 JWT payload를 단순 Base64 디코딩하거나 X-User-Role == STORE_ADMIN만 검사하는 코드는 권장안이 아닙니다.
위 A안은 작성자의 검토 권장안이며 이미 승인된 팀 정책으로 간주하지 않습니다.

## 합의 뒤 실제 구현 순서

1. Auth 담당이 로그인·토큰 발급과 안전하게 준비한 관리자/CUSTOMER 테스트 신원, 공개 검증 자료 및 token contract를 제공.
2. Gateway 담당이 설치 버전·공개 경로·JWT 정책·신원 전달/직접 호출 제한을 구현하고, 위조 헤더·만료/변조 토큰 거부를 검증.
3. 승인된 검증 방식과 의존성을 기반으로 Menu에서 AdminMenuAuthorization의 거부 구현을 실제 검증 경계에 연결.
   현재 Service·Repository·DTO·Controller와 조회 정책은 재사용. 모의 권한 허용을 운영 코드로 옮기지 않음.
4. 필터를 추가할 경우 인증이 파라미터 검증/조회보다 먼저 수행되도록 하고, 미인증/역할 부족 오류도 공통 envelope로 연결.
5. 실제 서명 검증을 포함한 Menu 테스트: 관리자 200, CUSTOMER 403, 토큰 없음/만료/잘못된 서명·issuer·audience·역할 401/403,
   알 수 없는 키·회전·검증 자료 장애의 fail-closed, 위조 헤더·직접 호출 우회 차단. 기대 status는 합의한 계약으로 확정.
6. dev에서 실제 로그인 → Gateway → Menu 목록/상세 200 및 거부 경로를 검사. 별도 격리 DB에서만 데이터 테스트.
   상기 실제 경로 검증과 필수 외부 리뷰·CI를 충족해야 #108 인증 완료로 표시.

## 이번에 안전하게 추가한 작업과 검증 한계

- 기존 제품 코드와 기본 차단을 유지. 실제 인증 어댑터를 연결할 근거가 없어 허용 경로를 추가하지 않음.
- 실제 서버에서 합성 unsigned JWT 및 가짜 서명이 붙은 관리자 claim을 전달해도 차단되고 DB가 조회되지 않는 회귀 3건 추가.
- 모의 Servlet principal/role만으로 관리자 신뢰가 생기지 않는 경계 검사 2건 추가. 실제 인증·암호학적 JWT 검증의 성공 검사가 아님.
- 인증 점검 당시 Java 21 Spotless/test/build 성공, 비DB 169건 통과였습니다.
  후속으로 격리 PostgreSQL 16.16에서 실제 DB 48건을 추가 실행하여 전체 217건 통과·실패/생략 0건을 확인했습니다.
  [실제 DB 검증 기록](menu-admin-postgresql-validation.md) 참조. 이는 인증 연동 성공을 의미하지 않습니다.
- 운영 클러스터·실제 Gateway 및 Auth 로그인 연동은 미검증. 다른 서비스·의존성·Gateway 정책을 변경하지 않음.

## #105와 Git 상태

PR #105는 미병합이며 head f274b20의 CI는 성공, 외부 리뷰 승인은 아직 없습니다.
자신이 작성한 열린 PR #85도 미병합·CI 성공·리뷰 승인 없음이며, 자신에게 요청된 타인 PR 리뷰는 조회 시 없었습니다.
검토 상태 확인과 실제 GitHub 수정·리뷰 요청·병합은 구분하며 이번에는 원격을 수정하지 않았습니다.

고객 코드를 복사하거나 통합하지 않았습니다. #105 통합 후 CustomerMenuHttpTests에 관리자 Repository mock을
추가하고, README·공유 HTTP 테스트의 변경을 합쳐 고객 조회 56건 및 기존/관리자 회귀를 다시 실행해야 합니다.
현재 브랜치에는 고객 API가 없으므로 통합 후 회귀 완료를 주장하지 않습니다.
