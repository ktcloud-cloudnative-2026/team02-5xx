# Auth 인증 연동 계약 및 검증 현황

> Issue #112 · 기준: main `24d4fc8` · 확인일: 2026-11-23
> 기존 Auth 담당 결정과 실제 구현을 정리한 문서다. Gateway·다른 서비스의 계약을 새로 정하거나 기존 API/ERD 원문을 변경하지 않는다.

- [Auth 담당 결정안](https://github.com/ktcloud-cloudnative-2026/team02-5xx/issues/112#issuecomment-7002438953)
- [프론트 필드·흐름 호환 확인](https://github.com/ktcloud-cloudnative-2026/team02-5xx/issues/112#issuecomment-7002604932)
- [구현 PR #164](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/164) · [실제 dev 배포 PR #181](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/181)
- [원본 API 초안](notion-draft.md) · [Auth 실행 설정](../../services/auth-service/README.md)

## 현재 완료 범위

| 구분     | 확인 결과                                                                                                      |
| -------- | -------------------------------------------------------------------------------------------------------------- |
| 구현     | AU-01·02·03·04·09·10과 공개 JWKS 구현, main 병합                                                               |
| 추가구현 | AU-05·06은 #221로 main 병합(`24d4fc8`). dev 배포 전                                                            |
| 로컬     | 동일 Auth 이미지와 임시 PostgreSQL로 실제 동작 검사 24개 통과                                                  |
| dev      | Argo CD 수동 Sync 완료, Synced·Healthy, 새 Pod Ready·재시작 0                                                  |
| DB       | 실제 앱 기동 시 Flyway V1·V2 적용 성공                                                                         |
| 공개키   | Gateway 및 직접 Auth JWKS 200, 같은 공개키·kid, 개인키 필드 없음                                               |
| 미검증   | Gateway JWT 검증·신원 전달, 실제 HTTPS 브라우저·프론트 연동                                                    |
| 회원가입 | dev의 실제 약관 버전 미설정으로 REGISTRATION_UNAVAILABLE 유지                                                  |
| prod     | 이 문서 작성 작업에서 조회·변경하지 않음. 별도 사전 연결 확인은 SSH 호스트 키 검증에서 실패해 설치 상태 미확인 |

로컬 결과를 dev 회원가입·로그인 성공으로, 공개키 조회를 Gateway JWT 검증 성공으로 표시하지 않는다.

## Auth API

일반 성공은 `success/data/message`, 실패는 `success/data/message/errorCode`를 사용한다. 실패 `data`는 null이다. 204에는 응답 본문이 없다.

| API                                       | 요청                                                              | 정상 결과                                         |
| ----------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------- |
| AU-01 POST /api/v1/auth/login             | JSON email·password 필수, rememberMe 선택(Boolean, 생략 시 false) | 200: accessToken·tokenType·expiresIn·user         |
| AU-02 GET /api/v1/auth/me                 | Authorization: Bearer Access Token                                | 200: id·email·nickname·role, nickname은 null 가능 |
| AU-05 PATCH /api/v1/auth/me               | Bearer Access Token, JSON nickname 필수(공백만 불가, 최대 50자)   | 200: AU-02와 같은 id·email·nickname·role          |
| AU-06 PATCH /api/v1/auth/me/password      | Bearer Access Token, JSON currentPassword·newPassword             | 204: 해당 회원의 모든 활성 Refresh 폐기·쿠키 삭제 |
| AU-03 POST /api/v1/auth/register          | JSON email·password·agreements                                    | 201: id·email                                     |
| AU-04 GET /api/v1/auth/email-availability | query email                                                       | 200: email·available                              |
| AU-09 POST /api/v1/auth/refresh           | Refresh 쿠키, 본문 없음, Access 불필요                            | 200: AU-01과 동일한 data 및 회전된 Refresh 쿠키   |
| AU-10 POST /api/v1/auth/logout            | 현재 세션 Refresh 쿠키, 본문 없음                                 | 204: 현재 세션 Refresh 폐기·쿠키 삭제             |
| GET /api/v1/auth/jwks                     | 인증 토큰 불필요                                                  | 200: 표준 JWK Set, 업무 응답 봉투 예외            |

AU-01·09의 `data` 구조:

```text
{
  accessToken: string,
  tokenType: "Bearer",
  expiresIn: 900,
  user: { id: number, email: string, role: "CUSTOMER" | "STORE_ADMIN" }
}
```

비밀번호·Refresh 원문·해시·개인키를 JSON 응답에 포함하지 않는다. AU-02·05·06은 Auth가 JWT와 현재 계정 상태를 직접 확인하며 임의 신원 헤더만 신뢰하지 않는다.

AU-06의 현재 비밀번호 불일치는 400 `CURRENT_PASSWORD_MISMATCH`다. 비밀번호 저장과 전체 Refresh 폐기는 한 트랜잭션이며, 이미 발급된 Access는 남은 만료시간 동안 유효할 수 있으므로 즉시 전체 로그아웃으로 안내하지 않는다. 세부 설계는 [회원정보·비밀번호 변경 제안](auth-profile-password-proposal.md)을 따른다.

AU-03의 agreements는 TERMS·PRIVACY 각각의 type/version/agreed다. 실제 AUTH_TERMS_VERSION·AUTH_PRIVACY_VERSION과 일치하고 둘 다 동의해야 한다. 프론트의 비밀번호 확인·보기는 서버 필드가 아니다. 기존 이메일 정규화와 Argon2id 저장을 유지한다. 자세한 가입 규칙은 [기존 가입 설계](auth-registration-design.md)를 따른다.

## 토큰·오류·브라우저 처리

- Access는 RS256 JWT, 수명 900초이며 프론트 메모리에 보관한다. sub는 회원 ID 문자열, role은 CUSTOMER 또는 STORE_ADMIN이다. iss/aud/iat/exp 및 서명을 검증한다.
- Refresh는 난수 토큰으로 Auth DB에 해시만 저장한다. rememberMe=false이면 서버 만료 1일·브라우저 세션 쿠키, true이면 서버 만료 14일·지속 쿠키다. 회전해도 로그인 때 정한 절대 만료를 연장하지 않는다.
- 현재 서버 쿠키: peakorderRefreshToken, HttpOnly·Secure·SameSite=Strict, Path=/api/v1/auth, Domain 생략. 실제 브라우저 배포 환경의 동작은 아직 미검증이다.
- 로그인·재발급·로그아웃은 허용 Origin 또는 Origin이 없을 때 Referer의 출처를 확인한다. 둘 다 없거나 불일치·중복이면 403 FORBIDDEN이다. AUTH_ALLOWED_ORIGINS는 이 검사용이며 CORS 응답을 자동 허용하지 않는다.
- 잘못된 로그인, 무효 Access, 유효하지 않은 Refresh는 현재 401 UNAUTHORIZED다. Refresh 실패는 Set-Cookie를 보내지 않는다. REFRESH_REUSED 등 세부 코드는 구현·확정된 계약으로 제시하지 않는다.
- 현재 구현은 엄격한 Refresh 회전이다. 사용된 Refresh 재사용 시 401 및 같은 로그인 세션의 활성 Refresh 폐기. 다른 로그인 세션은 유지한다. 정상 다중 탭 경쟁·응답 유실도 재로그인이 필요할 수 있다. 이를 새 정책으로 추가하는 것이 아니라 이미 배포된 동작과 한계로 기록한다.
- 프론트는 같은 탭의 Refresh 요청을 하나로 모으고 탭 간 회전도 조정해야 한다. 구체적인 브라우저 구현은 프론트 담당 범위다. Refresh 401에서 반복 갱신하지 않고, 403에서는 Refresh를 호출하지 않는다.
- 로그아웃은 현재 세션만 대상이다. 허용 출처 검사 후 쿠키 누락·반복 로그아웃도 204로 처리한다. 이미 발급된 Access를 즉시 전역 무효화하지 않는다.

## Gateway·서비스 담당자가 사용할 dev 정보

| 항목                    | 실제 dev 값                                                                                   |
| ----------------------- | --------------------------------------------------------------------------------------------- |
| JWKS                    | http://10.10.22.100/api/v1/auth/jwks                                                          |
| issuer                  | http://10.10.22.100                                                                           |
| audience                | peakorder-api-dev                                                                             |
| kid                     | auth-dev-01                                                                                   |
| 허용 Origin(dev 검증용) | http://127.0.0.1:5173                                                                         |
| 이미지                  | ghcr.io/ktcloud-cloudnative-2026/team02-5xx/auth:sha-b5bc639f4f692a56b124545410b1468dd40b5b49 |
| Git 배포 revision       | 45b30e2fc46573ee7a0eb348229f350e2592dfc3                                                      |

issuer는 발급자 식별자다. HTTP JWKS 200은 Envoy remoteJWKS의 HTTP 지원·토큰 검증·HTTPS 지원을 증명하지 않는다. 개인키와 DB 비밀값은 이 문서에 기록하지 않는다.

Gateway 담당은 [기존 보고](https://github.com/ktcloud-cloudnative-2026/team02-5xx/issues/112#issuecomment-7031158388)에서 한계를 포함한 A안 진행에 동의했다. 헤더 제거·NetworkPolicy 차단은 담당자 검증 기록이고, JWT 검증·claimToHeaders는 Auth 배포 이후 연결할 작업이다. 추가로 A/B 선택 전체를 처음부터 다시 승인받지 않는다.

## Gateway 신원 전달 계약 (#112 확정)

Gateway 담당의 [결정 기록](https://github.com/ktcloud-cloudnative-2026/team02-5xx/issues/112#issuecomment-7094381845)과 Auth의 [확인](https://github.com/ktcloud-cloudnative-2026/team02-5xx/issues/112#issuecomment-7095075470)으로 확정한 값이다. 실제 Gateway 적용·시험은 후속 구현 Issue에서 추적한다.

| 헤더          | 값                                        |
| ------------- | ----------------------------------------- |
| `X-User-Id`   | JWT `sub` 그대로 (회원 ID 숫자의 문자열)  |
| `X-User-Role` | JWT `role` 그대로 (CUSTOMER, STORE_ADMIN) |

- 클라이언트가 보낸 같은 이름의 헤더는 Gateway가 항상 제거하고, 검증된 JWT의 값만 넣는다.
- 서비스는 값을 변환·추측하지 않는다. 숫자가 아닌 ID나 두 값 외의 역할은 형식 오류다.

| 응답 | 책임    | 조건                                          |
| ---- | ------- | --------------------------------------------- |
| 401  | Gateway | 토큰 없음·만료·서명/issuer/audience 검증 실패 |
| 401  | 서비스  | 신원 헤더 누락·형식 오류 (Gateway 우회 방어)  |
| 403  | 서비스  | 역할 부족                                     |
| 404  | 서비스  | 본인 자원 아님                                |

- Gateway 401 본문은 Envoy 기본 응답이며 공통 JSON이 아니다. 공통 응답 형식의 임시 예외로 두고, 프론트는 상태코드 401만으로 재발급·로그인 흐름을 처리한다. 공통 JSON화는 후속 구현 항목이다.
- Auth의 JWT 비요구 경로: `POST /login`, `POST /register`, `GET /email-availability`, `GET /jwks`, `POST /refresh`, `POST /logout`. refresh·logout은 Access 없이 Refresh 쿠키로만 호출된다.
- `/me`, `/me/password`는 Auth가 Bearer 토큰을 직접 검증하므로 Gateway 보호 경로 여부와 관계없이 동작이 같다.
- 남는 신뢰 경계(허용된 Pod의 헤더 위조, hostNetwork 등)는 NetworkPolicy 기본 차단, Git PR → Argo CD 배포, 관리자 API 기본 차단 유지, `/internal/v1/**` 비노출을 전제로 수용한다.

| 남은 작업                                             | 담당·처리 기준                                                                                          |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Gateway JWT 검증·claimToHeaders·경로 분리 구현과 시험 | Gateway 담당 후속 Issue. Auth가 다른 담당자 정책을 임의 변경하지 않는다                                 |
| 실제 HTTPS origin, 쿠키·CORS·CSRF 브라우저 검증       | Gateway·프론트와 실제 환경에서 확인한다. Secure 쿠키를 임의로 완화하지 않는다                           |
| 관리자 API                                            | 각 서비스에서 STORE_ADMIN 검사. Gateway JWT 검증·신뢰 경계 연결 전 기존 차단 유지                       |
| 실제 약관 버전                                        | 기존 이용약관·개인정보 문서의 버전을 프론트와 맞춘 뒤 가입 활성화. 테스트 버전을 운영값으로 넣지 않는다 |
| 회원가입·로그인·갱신·로그아웃 최종 화면 연동          | 프론트 #156·#201과 협력. 페이지·장바구니 상태 유지                                                      |

## Auth 원본 명세 대비 잔여 기능

AU-05 회원정보 수정과 AU-06 비밀번호 변경은 #221로 main에 병합됐고 dev 배포 전이다. AU-07·08 비밀번호 재설정은 아직 구현되지 않았다. 본인 확인·재설정 전달 방식은 별도 구현 범위에서 구체화한다. 현재 문서 작업으로 새 메일 발송 도구나 API 정책을 추가하지 않는다.

따라서 Auth dev 서버 배포 완료와 Auth 전체 명세 완료는 구분한다. #112는 위 계약 결정으로 종료하고, Gateway·브라우저 구현과 검증은 후속 Issue로 추적한다.
