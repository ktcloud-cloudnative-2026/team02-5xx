# Auth 회원정보·비밀번호 변경 설계 및 구현 현황 — AU-05·06

> 상태: **프론트 설계 의견 반영 / 로컬 구현·162개 테스트 통과 / 최종 코드 리뷰 대기**
> [Issue #215](https://github.com/ktcloud-cloudnative-2026/team02-5xx/issues/215) · 기준 main `dfb6271` · 2026-11-23

기존 명세의 AU-05·06에 대해 프론트가 동의한 핵심 설계와 Auth 담당의 경계 보완을 같은 브랜치에 구현했다. 최종 코드 리뷰 전이며 main·dev에 반영된 기능이 아니다. 아래 최초 제안과 설계 검토 기록을 보존하고, 최종 보완값과 검증 결과는 후반부에 명시한다.

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

**전체 기기 재로그인은 기존 명세의 필수 사항이 아니라 보안상 제안이다.** 현재 세션만 종료하는 안을 원하면 프론트 의견에 함께 남겨 달라. 기존 전체 세션 Refresh를 유지하면 비밀번호를 바꿔도 이미 유출된 Refresh가 계속 사용될 수 있어, Auth 쪽은 전체 폐기를 제안한다. 프론트의 설계 COMMENT에서 전체 Refresh 폐기에 동의했고 현재 브랜치에 그 안을 구현했다. 이는 최종 코드/병합 승인이나 모든 기기의 Access 즉시 차단을 뜻하지 않는다.

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

실패는 기존 success/data/message/errorCode 구조를 유지한다. CURRENT_PASSWORD_MISMATCH는 이 브랜치에서 추가한 코드이며 main·dev에는 아직 반영되지 않았다. Gateway·쿠키/CORS/CSRF의 환경별 계약은 기존 #112와 구분하며 이 문서에서 임의 변경하지 않는다.

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

프론트 설계 의견을 반영해 **같은 Issue·브랜치·PR에 로컬 구현과 검증을 추가**했다. 최종 코드 리뷰·CI·사용자 병합 지시 전에는 병합/배포하지 않는다. 공유 DB·dev/prod는 변경하지 않았다. AU-07·08 비밀번호 재설정, 가입 이메일 인증, 다른 회원 관리와 Gateway 변경은 제외한다.

## 프론트 설계 리뷰 반영 및 경계 명시 (2026-11-23)

MyaNiss가 HEAD 498759b의 요청 필드·200/204·오류 구분·전체 Refresh 폐기·화면/장바구니 보존에 동의했다. 이는 설계 COMMENT이며 최종 구현/병합 승인이 아니다. 아래 두 항목은 원래 최소 제안 범위를 명확히 한 Auth 담당 기준으로 추가하며 후속 리뷰 의견을 받는다.

- 닉네임 삭제 기능은 이번 범위에 추가하지 않는다. nickname 누락·null·공백만인 값은 400 INVALID_REQUEST다. AU-02가 기존 미설정 회원의 nickname=null을 반환할 수 있는 것과 PATCH에서 null 초기화를 지원하는 것은 구분한다. 앞뒤 공백은 strip/trim하지 않고 그대로 저장·반환하며, 최대 50자는 기존 DB와 맞게 코드 포인트로 검사한다.
- 비밀번호 변경 204가 이미 DB 변경·전체 Refresh 폐기·현재 쿠키 삭제를 완료한 응답이다. 프론트는 JSON을 파싱하거나 기존 logout()으로 /logout을 다시 호출하지 않고, 로컬 Access 메모리·인증 스냅샷·진행 중 세션 요청을 무효화하는 경로로 재로그인을 안내한다. 프론트 내부 함수명/구현은 프론트 담당자가 정하며 이 PR에서 코드를 수정하지 않는다. 400 실패에는 쿠키를 삭제하지 않는다.

같은 브랜치에서 Auth 로컬 구현과 회귀 검증을 완료했다. 신규 필드·응답·세션 정책의 실제 코드 최종 리뷰와 CI·병합·배포는 별도로 구분한다. 이 보완으로 새로운 닉네임 삭제/이메일 변경/전역 Access 블랙리스트를 추가하지 않는다.

## 로컬 구현 및 검증 결과

- AU-05: 본인 ACTIVE/CUSTOMER 계정의 nickname만 변경, 200으로 기존 내 정보 형태 반환. null 초기화는 지원하지 않고 앞뒤 공백·Unicode 입력은 값 그대로 보존한다.
- AU-06: 기존 Argon2id와 새 비밀번호 설정 사용. 비밀번호 변경과 본인 전체 활성 Refresh 폐기를 기존 사용자 잠금 아래 한 트랜잭션으로 처리하고 204·쿠키 삭제로 응답한다. 현재 비밀번호 불일치 400에는 쿠키를 삭제하지 않는다.
- 기존 SessionService의 로그인·회전·현재 세션 로그아웃 구현과 DB 스키마는 수정하지 않았다. Bearer 헤더 파싱만 컨트롤러 공통 helper로 추출했다.
- 새 라이브러리·Action·DB 컬럼 없음. 기존 validation에 포함된 CodePointLength로 닉네임을 검사한다.
- Java 21·Wrapper 8.14.3·기존 Gradle 캐시와 일회용 로컬 PostgreSQL로 spotlessApply·spotlessCheck·test·build 성공.
- JUnit **162개 통과(기존 134 + 신규 28), 실패·오류·생략 0**. 실제 PostgreSQL 테스트 23개를 포함한다.
- 본인/역할/현재 상태·누락/미정의 필드·닉네임 경계·200/204/400/401/403·해시 저장·본인 전체 세션 폐기·다른 회원 세션 보존·이전 Access 잔여 유효·실패 rollback·Refresh/비밀번호 변경 경합·동시 비밀번호 변경 한 건 성공을 검증했다.
- 로컬 DB URL은 localhost/127.0.0.1의 전용 auth_registration_test로 제한했다. 일회용 DB 컨테이너·데이터와 테스트 키는 정리했다. 실제 dev/prod DB·서버·키는 사용하지 않았다.

이 결과는 프론트 실제 화면·HTTPS·Gateway 통합 성공이 아니다. 로컬 구현 검증과 최종 코드 승인·GitHub CI·배포를 구분한다.
