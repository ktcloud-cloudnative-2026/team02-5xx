# Auth dev 세션 활성화 설정 후보 — Issue #174

> **준비용이며 현재 배포에 연결되지 않는다.** 이 디렉터리에는 Kustomization이 없고, 기존 base·dev·prod도 이 파일을 참조하지 않는다. Deployment 패치 조각이므로 직접 apply하지 않는다.
>
> 운영 값 결정·Secret 생성·키 생성·이미지 게시·실제 활성화는 별도 승인 대상이다. 기존 prod Gateway와 ADDRESS `10.10.22.200`은 보존한다.

## 기준과 선행 작업

- 설정 이름은 [Auth PR #164](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/164)의 `eb58a74` 구현 기준이다. 아직 main 반영 전이며, 현재 main과 배포 이미지가 JWT 기능을 제공한다고 가정하지 않는다.
- 기존 [Auth 배포 구성](../../README.md), [dev Overlay](../../overlays/dev/kustomization.yaml), [#112 계약](https://github.com/ktcloud-cloudnative-2026/team02-5xx/issues/112)을 따른다. 기존 CI·서비스 코드·HTTPRoute·Argo CD Application은 바꾸지 않는다.
- prod Gateway 상태는 [#171 적용 기록](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/171#issuecomment-7028783145)에 근거하며 직접 재검증한 결과는 아니다. Gateway 삭제·재생성·ADDRESS 변경을 포함하지 않는다.

## 외부에서 준비할 값

아래 Secret 이름·키는 **연결 후보**이며 실제 존재 여부나 값은 조회하지 않았다. 환경별 값과 준비 여부를 담당자에게 확인한다. 값을 Git·PR·로그·셸 기록에 복사하지 않는다. dev는 Auth 소유 dev DB에만 연결한다.

| Secret 후보          | 키              | 컨테이너 환경 변수 또는 파일              | 확인 담당                                |
| -------------------- | --------------- | ----------------------------------------- | ---------------------------------------- |
| auth-service-db      | DB_URL          | AUTH_DB_URL                               | Auth·DB: Auth dev DB 주소                |
| auth-service-db      | DB_USER         | AUTH_DB_USERNAME                          | DB: Auth dev 전용 계정                   |
| auth-service-db      | DB_PASSWORD     | AUTH_DB_PASSWORD                          | DB: 비공개 경로로 주입                   |
| auth-service-runtime | issuer          | AUTH_JWT_ISSUER                           | Auth·Gateway: 발급자 식별 값             |
| auth-service-runtime | audience        | AUTH_JWT_AUDIENCE                         | Auth·Gateway: 검증 대상 값               |
| auth-service-runtime | key-id          | AUTH_JWT_KEY_ID                           | Auth·Gateway: 공개 JWKS kid와 일치       |
| auth-service-runtime | allowed-origins | AUTH_ALLOWED_ORIGINS                      | Gateway·프론트: 정확한 HTTPS Origin 목록 |
| auth-service-runtime | terms-version   | AUTH_TERMS_VERSION                        | Auth·프론트: 실제 이용약관 버전          |
| auth-service-runtime | privacy-version | AUTH_PRIVACY_VERSION                      | Auth·프론트: 실제 개인정보 동의 버전     |
| auth-service-jwt     | private-key.pem | /var/run/secrets/auth-jwt/private-key.pem | Auth·운영: RSA PKCS#8 개인키             |
| auth-service-jwt     | public-key.pem  | /var/run/secrets/auth-jwt/public-key.pem  | Auth·운영: 대응하는 X.509 공개키         |

issuer·audience·Origin·약관 버전은 비밀번호가 아니지만 ConfigMap 허용을 추가하지 않고 Secret 참조 방식으로 함께 주입하는 후보다. 이름·배포 책임이 정해지면 일괄 맞춘다. 현재 AppProject에는 Secret 생성 권한이 없으며 이 작업에서 권한을 넓히지 않는다. Secret은 실제 배포 전에 승인된 별도 운영 경로로 준비한다.

JWT 키는 2048비트 이상의 대응 쌍이고 kid는 Auth 검증 규칙을 만족해야 한다. 기존 공통 Java 이미지는 USER=app을 사용한다. UID를 고정하지 않고 보조 그룹 2000과 Secret 0440·readOnly 마운트를 조합했다. 실제 배포 전 해당 이미지 사용자와 Secret 파일 읽기를 확인한다. 실행 중 파일 변경만으로 키가 자동 재로딩된다고 가정하지 않는다. 키 교체는 별도 절차다.

## 실제 연결 전 완료 조건

1. #164의 인증·DB 변경에 대한 작성자 외 팀원 승인을 확인하고 Squash 병합한다. AI가 자동 병합하지 않는다.
2. 병합 커밋의 main CI에서 검사·GHCR 게시·CI Final 성공을 확인하고 실제 존재하는 전체 SHA 이미지 태그를 확인한다. PR head 태그나 현재 초기본 태그를 새 JWT 이미지로 간주하지 않는다.
3. 위 표의 dev 값·Secret 주입 책임과 약관 버전을 확인한다. dev DB 백업/복구 준비, 현재 Flyway 이력·V1/V2 적용 가능 여부는 DB 담당 승인 하에 점검한다. 비밀값을 출력하지 않는다.
4. Gateway·프론트와 dev HTTPS 주소, Secure/Strict 쿠키 저장·전송, 정확한 Origin을 확인한다. prod 도메인·IP를 dev 발급자나 Origin으로 임의 재사용하지 않는다. CORS 응답·credentials·TLS 종료 위치는 이 패치로 설정되지 않는다.
5. 별도 dev 활성화 Issue·PR에서 dev 이미지 태그 갱신과 이 패치 연결을 함께 검토한다. 현재 dev/prod Overlay는 준비 PR에서 수정하지 않는다.
6. 실제 활성화 PR의 CI와 외부 승인을 받은 후 기존 Auth Argo CD Application의 dev 경로로 수동 Sync한다. AppProject·Gateway 재생성이나 prod 직접 apply는 포함하지 않는다.

**기능 활성화와 Flyway는 별개다.** #164 이미지가 DB에 연결해 기동하면 AUTH_SESSION_ENABLED=false여도 V2가 적용 대상이다. 신규 기능을 끄는 것을 DB 변경 승인 생략으로 사용하지 않는다. 수동 DDL·자동 down migration은 수행하지 않는다.

## 로컬 준비 검증

1. 기존 base·dev·prod를 렌더링하고 원래 main과 비교한다. 현재 dev/prod 이미지 태그·리소스가 같아야 한다.
2. 별도 임시 복사본에서만 dev Kustomization의 patches에 이 후보를 연결한다. dev Overlay 옆에 임시 파일로 복사하면 경로 제한을 완화할 필요가 없다.
3. Deployment·Service·HTTPRoute 3개, namespace·라벨·기존 Probe·포트·HTTPRoute 보존, env/Secret 키·키 파일 경로·0440/readOnly·보조 그룹을 검사한다.
4. 임시 연결 결과는 새 이미지 확정 전의 **구조 검증용**이며, 실제 동작하는 JWT 배포 구성이 완성됐다는 의미는 아니다.
5. 임시 파일을 정리하고 Auth 구현 PR·다른 작업 폴더·prod 파일이 바뀌지 않았는지 확인한다.

## 활성화 후 검증할 항목

- 승인한 이미지 SHA, Pod Ready, 재시작·설정 바인딩·DB/Flyway 오류 여부. 로그에 비밀값을 출력하지 않는다.
- 서비스 내부와 Gateway 경유 GET /api/v1/auth/jwks의 200, 공개 RSA 키·kid 일치, 개인키 필드 부재.
- 승인된 테스트 계정으로 로그인·내 정보·재발급·로그아웃, 401/403·204와 WWW-Authenticate. 토큰 원문을 기록하지 않는다.
- 실제 dev HTTPS 브라우저에서 Refresh 쿠키 저장·전송·삭제, 탭 간 갱신 조정·초기 복원·응답 유실 처리.
- 검증한 JWKS 주소·issuer·audience·kid·이미지 SHA를 Gateway 담당에게 전달하고 검증 정책 연결을 요청한다. A/B 결정과 다른 서비스 관리자 권한 차단 해제는 별도 검증 대상이다.

## 복구와 후속

앱 문제 시 승인된 Git 변경으로 직전 배포 이미지/설정으로 복구하고 Argo CD로 반영한다. V2 테이블 삭제·자동 DB 복구는 하지 않는다. 이미지 복구만으로 DB·토큰 호환성이 보장되지 않으므로 DB/인증 담당 확인이 필요하다.

prod Auth 배포·prod Argo CD 등록, Gateway GitOps 편입, TLS/CORS 운영 설정, 키 교체·과거 Refresh 이력 정리는 별도 작업이다. 기존 prod Gateway는 그대로 보존한다.

## 이번 준비 작업의 로컬 검증 결과 (2026-11-20)

- 원래 main과 현재 작업 폴더의 Auth base·dev·prod 렌더링 3개가 모두 동일했다.
- 임시 복사본에서만 후보를 연결해 Deployment·Service·HTTPRoute 3개를 렌더링했다. Deployment 외 리소스, 이미지·포트·Probe·selector·namespace·라벨 보존을 검사했다.
- Auth #164 설정 이름에 대응하는 환경 변수 12개, DB/runtime Secret 키, JWT 키 경로 2개·필수 Secret·0440/readOnly·보조 그룹 2000의 구조를 검사했다.
- Prettier·Git 공백 검사 통과. 실제 비밀값·키·토큰·임시 산출물은 준비 파일에 포함하지 않았다.
- 실제 Secret 존재·파일 읽기·키 유효성·DB 마이그레이션·클러스터 기동·HTTPS 브라우저·Gateway 연동은 검증하지 않았다. 구조 검증을 실제 배포 성공으로 표시하지 않는다.
- 서비스 코드는 바꾸지 않아 Auth JUnit 134개와 기존 공통 CI 테스트를 중복 실행하지 않았다. #164의 검증 결과와 이 준비 작업의 결과는 구분한다.
