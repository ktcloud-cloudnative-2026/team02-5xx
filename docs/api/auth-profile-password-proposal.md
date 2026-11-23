# Auth 회원정보·비밀번호 변경 API 제안 — AU-05·06

> 상태: **Auth 담당 초안 / 프론트 리뷰 요청 / 미확정·미구현**
> [Issue #215](https://github.com/ktcloud-cloudnative-2026/team02-5xx/issues/215) · 기준 main `dfb6271` · 2026-11-23

기존 명세에 있는 AU-05·06을 구현하기 전에 프론트와 요청·응답 및 로그인 상태 처리만 맞추기 위한 제안이다. 이 문서의 필드·새 오류 코드·전체 세션 폐기는 아직 서버에 구현되지 않았고 팀 확정 규칙이 아니다.

기존 로그인·JWT·재발급 계약은 [PR #214](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/214)에서 정리한다. 이 PR에서는 아래 두 기능의 미정 사항을 실제로 제안하고 프론트 의견을 받는다.

## 기존 명세와 구현에서 유지할 사항

| 항목               | 기존 기준                                                                              |
| ------------------ | -------------------------------------------------------------------------------------- |
| AU-05              | PATCH /api/v1/auth/me, 닉네임 등 회원정보 수정, CUSTOMER                               |
| AU-06              | PATCH /api/v1/auth/me/password, 현재 비밀번호 확인 및 변경, CUSTOMER                   |
| 비밀번호 변경 화면 | 현재 비밀번호·새 비밀번호·새 비밀번호 재입력·취소                                      |
| 회원·로그인        | 기존 숫자 ID·역할·ACTIVE 상태 확인 및 Bearer Access Token 사용                         |
| DB                 | users.nickname은 기존 VARCHAR(50), 비밀번호는 기존 password_hash에 Argon2id 저장       |
| 새 비밀번호 길이   | 기존 가입 구현의 설정 재사용(개발 기본값 12~64자). 팀의 새 공통 규격으로 추가하지 않음 |
| 공통 응답          | 일반 JSON은 success/data/message 및 실패 시 errorCode, 204는 본문 없음                 |

근거: [원본 API·화면 초안](notion-draft.md), [기존 User](../../services/auth-service/src/main/java/com/peakorder/auth/entity/User.java), [V1 스키마](../../services/auth-service/src/main/resources/db/migration/V1__create_auth_registration_tables.sql), [Auth README](../../services/auth-service/README.md).

## 프론트에 제안하는 결정값

| 검토 항목            | Auth 담당 제안                                 | 프론트에서 확인할 점                                     |
| -------------------- | ---------------------------------------------- | -------------------------------------------------------- |
| 회원정보 수정 필드   | nickname 하나만 변경                           | 현재 화면 입력으로 충분한지                              |
| 닉네임 검증          | 공백만인 값 거절, 최대 50자                    | 입력 제한·오류 표시와 맞는지                             |
| 회원정보 성공 응답   | 200, AU-02와 같은 현재 회원정보                | 화면 상태를 바로 갱신할 수 있는지                        |
| 비밀번호 요청        | currentPassword / newPassword                  | 화면 필드명과 맞는지, 재입력 확인은 프론트 처리 가능한지 |
| 현재 비밀번호 불일치 | 400 CURRENT_PASSWORD_MISMATCH                  | 재발급 시도 없이 현재 비밀번호 오류를 표시할 수 있는지   |
| 비밀번호 성공 응답   | 204, Refresh 쿠키 삭제                         | JSON 파싱 없이 로그인 상태를 비울 수 있는지              |
| 변경 후 세션         | 모든 로그인 세션의 Refresh 폐기, 재로그인 안내 | 전체 기기 재로그인 안내·현재 화면/장바구니 보존과 맞는지 |

**전체 기기 재로그인은 기존 명세의 필수 사항이 아니라 보안상 제안이다.** 현재 세션만 종료하는 안을 원하면 프론트 의견에 함께 남겨 달라. 기존 전체 세션 Refresh를 유지하면 비밀번호를 바꿔도 이미 유출된 Refresh가 계속 사용될 수 있어, Auth 쪽은 전체 폐기를 제안한다. 최종 선택 전 어느 안도 확정·구현으로 표시하지 않는다.

## AU-05 요청·응답 초안

```http
PATCH /api/v1/auth/me
Authorization: Bearer <Access Token>
Content-Type: application/json
```

```json
{
  "nickname": "피크고객"
}
```

- 본인의 ACTIVE 계정이며 CUSTOMER인 경우만 수정한다.
- 다른 userId, email, role, status 또는 정의하지 않은 필드는 받지 않는다.
- 성공은 HTTP 200, 아래와 같이 기존 내 정보 응답 구조를 재사용한다. 예시 데이터는 가상 값이다.

```json
{
  "success": true,
  "data": {
    "id": 123,
    "email": "member@example.invalid",
    "nickname": "피크고객",
    "role": "CUSTOMER"
  },
  "message": "회원정보가 변경되었습니다."
}
```

별도 사용자 지정·이메일 변경·권한 변경·관리자 회원 수정 기능은 추가하지 않는다.

## AU-06 요청·응답 초안

```http
PATCH /api/v1/auth/me/password
Authorization: Bearer <Access Token>
Content-Type: application/json
```

```json
{
  "currentPassword": "<사용자가 입력한 현재 비밀번호>",
  "newPassword": "<사용자가 입력한 새 비밀번호>"
}
```

- 새 비밀번호 재입력은 화면에서 일치 여부를 확인하며 서버 필드로 보내지 않는다.
- 현재 비밀번호 원문을 기존 해시와 확인하고 새 비밀번호는 기존 규칙·Argon2id로 처리한다. 비밀번호의 공백·문자를 임의로 변경하지 않는다.
- 성공은 **HTTP 204 No Content**, JSON 본문 없이 기존 Refresh 쿠키 삭제 헤더를 보낸다.
- 제안한 전체 세션 폐기를 채택하면 비밀번호 변경과 해당 회원의 활성 Refresh 폐기를 한 트랜잭션으로 처리한다. 프론트는 Access 메모리·로그인 상태를 비우고 재로그인을 안내한다.
- 이미 발급된 Access는 기존 구조에서 즉시 전역 폐기되지 않는다. 기존 900초 수명과 허용 시계 오차 내 남은 시간 동안 유효할 수 있다. 전체 Refresh 폐기를 Access까지 즉시 폐기하는 기능으로 안내하지 않는다.
- 새 JWT claim·블랙리스트·DB 컬럼·메일 발송 도구는 이 제안에 추가하지 않는다.

### 오류 표시 제안

| 상황                                        | HTTP / errorCode                          | 프론트 동작 제안                                                    |
| ------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------- |
| 입력 누락·형식·닉네임/새 비밀번호 검증 실패 | 400 INVALID_REQUEST                       | 해당 화면에서 입력 안내                                             |
| 현재 비밀번호 불일치                        | 400 CURRENT_PASSWORD_MISMATCH (신규 제안) | 현재 비밀번호 오류 안내, Refresh 호출하지 않음                      |
| Access 누락·무효·만료                       | 401 UNAUTHORIZED                          | 기존 인증 계약대로 처리, 변경 요청의 무조건 자동 재전송은 하지 않음 |
| CUSTOMER가 아니거나 권한 부족               | 403 FORBIDDEN                             | 권한 안내, Refresh 호출하지 않음                                    |

실패는 기존 success/data/message/errorCode 구조를 유지한다. CURRENT_PASSWORD_MISMATCH는 아직 실제 서버 응답 코드가 아니다. Gateway·쿠키/CORS/CSRF의 환경별 계약은 기존 #112와 구분하며 이 문서에서 임의 변경하지 않는다.

## 프론트 담당 리뷰 요청

다음 항목마다 **동의 / 수정 의견**을 남겨 달라.

- [ ] nickname만 수정하는 최소 범위와 요청 필드명
- [ ] currentPassword/newPassword 필드명 및 재입력 확인의 프론트 처리
- [ ] 회원정보 200·비밀번호 204 및 오류 코드/화면 표시
- [ ] 전체 Refresh 폐기·재로그인 정책 또는 원하는 대안
- [ ] 변경 후 현재 화면·장바구니 보존 및 로그인 안내 흐름

모든 기존 로그인 계약을 다시 승인받는 요청이 아니라 위 미정 부분에 대한 연동 검토다. 서비스 내부 클래스·메서드·저장소 구현·테스트 구조는 확정된 계약과 팀 규칙 안에서 Auth 담당자가 정한다.

## 합의 후 구현·검증 범위

기존 인증 검증과 사용자 잠금을 재사용해 controller/DTO/service/repository를 보완하고, 정상 변경·권한·잘못된 현재 비밀번호·입력·미정의 필드·Refresh 경합/폐기 회귀를 검증한다. 원본 API/ERD·다른 서비스 코드는 수정하지 않는다.

현재 PR은 제안 문서만 포함한다. 의견 합의 후 **같은 Issue·브랜치·PR에 구현과 검증을 추가**하고 최종 리뷰·CI를 거쳐 병합한다. 설계 의견이 도착하기 전 기능 코드·공유 DB·dev/prod 배포는 변경하지 않는다. AU-07·08 비밀번호 재설정, 가입 이메일 인증, 다른 회원 관리와 Gateway 변경은 제외한다.
