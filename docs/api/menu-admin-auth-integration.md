# Menu 관리자 공통 인증 경계 — #245

## 합의와 현재 실행 상태

[#112 Gateway 담당 결정](https://github.com/ktcloud-cloudnative-2026/team02-5xx/issues/112#issuecomment-7094381845)에 따라 A안(Gateway JWT 검증 → 신원 헤더 → 서비스 업무 권한 검사)을 기준으로 한다.
`X-User-Id`는 JWT sub의 숫자 문자열, `X-User-Role`은 CUSTOMER 또는 STORE_ADMIN이다.
Gateway는 외부 신원 헤더를 제거하고 검증 JWT claim만 전달해야 한다.
Gateway의 토큰 누락·검증 실패는 기본 401이며 현재 공통 JSON이 아닌 응답을 허용한 계약이다.
서비스는 공통 ApiResponse로 신원 누락·형식 오류 401 UNAUTHORIZED, 역할 부족 403 FORBIDDEN을 반환한다.

**계약 결정과 실제 적용·배포 검증은 다르다. 현재 Menu 관리자 HTTP는 전부 기본 403 차단이다.**
Gateway SecurityPolicy/remoteJWKS·claimToHeaders와 외부 헤더 제거의 순서, 직접 호출 차단까지 완료됐다는 증거가 없으므로 실제 공개 활성화를 하지 않는다.

## 공통 구조

- ME-03·04·05·06·07의 Controller가 하나의 `AdminMenuAuthorization.requireStoreAdmin()`을 ID 변환·본문 읽기·Service 호출 전에 실행한다.
- `AdminMenuGatewayTrust.isVerified(request)`는 제품 코드에서 항상 false다. 설정/프로필/환경 변수로 켜는 기능은 없다. 헤더·검증되지 않은 Bearer·Servlet principal/role·ClusterIP라는 사실은 신뢰 증거가 아니다.
- 공통 정책은 신뢰 경계가 검증됐을 때만 신원 헤더를 읽도록 준비했다. 헤더는 각각 정확히 한 개여야 하며 중복/콤마 결합·공백·잘못된 역할을 거절한다. 회원 ID는 선행 0 없는 ASCII 십진 양의 Long 범위(`[1-9][0-9]*`)다. `007`, `01`, `00`은 인증 오류 401이며 ID를 임의 정규화하지 않는다. 값을 추정하거나 대체하지 않는다.
- 신뢰 경계가 검증된 요청의 ID·역할 누락/형식 오류는 401, CUSTOMER는 403, STORE_ADMIN만 통과한다. 현재 기본 차단에서는 이 단계에 도달하지 않는다.
- `AdminMenuExceptionHandler` 하나가 네 관리자 Controller의 인증·업무·예기치 않은 오류를 공통 형식으로 처리한다. 고객/내부 Controller advice와 Jackson 전역 설정은 유지한다.
- 기존 `MenuCreateAuthorization`·`MenuUpdateAuthorization`·`MenuStatusAuthorization`과 중복 advice를 통합했다. DTO·업무 오류의 기존 status/code/메시지는 보존한다.

실제 JWT 검증기·신뢰 판별기·신규 라이브러리·Gateway/NetworkPolicy/HTTPRoute는 이 작업에서 추가하지 않았다.
운영 허용을 위해서는 실제 검증 근거와 담당자 리뷰 후 현재의 명시적 deny 구현을 교체해야 한다. 단순 설정 활성화 작업이 아니다.

## 검증 경계

- 기본 차단 테스트는 실제 공통 권한 코드에서 임의 역할/ID/Bearer와 Servlet 신원을 거절한다. 각 기능의 기존 deny 테스트도 보존했다.
- 순수 정책 테스트와 통합 HTTP/DB 테스트에서만 Gateway 신뢰 판정을 모의해 정상 관리자·401·403·중복/형식 오류를 검증했다. 제품에 허용 Bean이나 테스트 우회 플래그는 없다.
- HTTP 통합 테스트는 실제 Controller·DTO·Service·Repository·PostgreSQL을 통과하지만 JWT 서명 검증·실제 Gateway·dev 인증 성공을 증명하지 않는다.

## 서비스별 관리자 API 활성화 절차 — 후속 #280

현재 PR #251은 Menu ME-03~07 통합·정책 검사 및 **실제 관리자 요청 기본 403 차단**까지만 완료한다. [후속 #280](https://github.com/ktcloud-cloudnative-2026/team02-5xx/issues/280)에서 실 Gateway 인증과 서비스 노출을 처리하며, 이번 PR의 병합만으로 접근을 열지 않는다.

- **공통 선행 검증:** Gateway JWT 서명·발급자·대상·만료/JWKS 검증, 외부 `X-User-Id`/`X-User-Role` 헤더 제거 후 검증된 claim만 전달, 헤더 위조·중복·대소문자 변형 거부, 미인가 Pod/Service 직접 접근 및 관리자 HTTPRoute 우회 차단을 실제 dev에서 확인한다.
- **Menu:** `AdminMenuGatewayTrust.isVerified()`는 제품 코드에서 상시 `false`. 위 증거가 확보되고 인증·Gateway·서비스 담당 리뷰가 끝난 뒤에만 별도 PR로 신뢰 경계를 구현·연결한다. 단순 역할 헤더·프로필·설정만으로 허용하지 않는다.
- **Inventory 등:** `INVENTORY_ADMIN_ENABLED`와 같은 관리자 API 등록 플래그는 위 공통 검증과 담당자 리뷰를 마친 뒤 단계적으로 활성화한다. Menu의 명시적 deny와 다른 서비스의 노출 플래그는 구현 방식이 다르므로 **동일한 토글로 무조건 일괄 활성화하지 않는다.**
- **적용 순서:** 먼저 Gateway 보호 경로·헤더 처리와 직접 호출 차단을 검증 → 서비스별 신뢰 정책/플래그 변경을 별도 리뷰·PR로 적용 → STORE_ADMIN 성공, 익명/잘못된 JWT 401, CUSTOMER 403, 고객 공개 API·내부 경로 분리, 위조/우회 실패를 실서비스로 재검증한다.
- **실패 시 복구:** 보호 경로 또는 신뢰 판정이 불확실하면 해당 관리자 API를 다시 차단(Menu deny, Inventory 등 노출 플래그 off)하고 변경 사항을 GitOps 절차에 따라 롤백/복구한다. 공유 dev/prod의 임의 활성화를 금지한다.

## 공개 활성화 전 남은 의존성

1. Gateway JWT 서명/issuer/audience/만료 검증, JWKS 취득·회전·장애 거부와 공개/보호 HTTPRoute 분리.
2. 클라이언트 신원 헤더 제거 및 claimToHeaders 적용 순서, 중복·대소문자·위조 헤더 시험.
3. 허용되지 않은 Service/Pod 직접 호출 차단과 NetworkPolicy 적용 확인. #112에서 수용한 허용 Pod 사칭·hostNetwork 위험은 수용 조건(PR→Argo CD, 기본 네트워크 차단 등)과 함께 재확인.
4. 실제 STORE_ADMIN 성공, 비회원/무효 JWT 401, CUSTOMER 403, 고객 공개 경로와 내부 경로 외부 차단 검증.
5. 인증·보안/서비스 간 계약에 대한 작성자 외 리뷰와 CI 확인. 기존 Draft 종료·통합 PR·배포·main 병합은 별도 승인 사항이다.
