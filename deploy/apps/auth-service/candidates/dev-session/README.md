# Auth dev 세션 활성화 설정 후보 — Issue #174

> **준비용이며 현재 배포에 연결되지 않는다.** 이 디렉터리에는 Kustomization이 없고, 기존 base·dev·prod도 이 파일을 참조하지 않는다. Deployment 패치 조각이므로 직접 apply하지 않는다.
>
> 운영 값 결정·Secret 생성·키 생성·이미지 게시·실제 활성화는 별도 승인 대상이다. 기존 prod Gateway와 ADDRESS `10.10.22.200`은 보존한다.

## 기준과 선행 작업

- 설정 이름은 [Auth PR #164](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/164)의 검증된 구현 기준이다. #164는 외부 DB 승인과 CI 통과 후 main `b5bc639f4f692a56b124545410b1468dd40b5b49`로 Squash 병합됐다. 실행 중인 dev 이미지는 아래 직접 조회 결과처럼 초기본이며, 새 코드 활성화는 별도 이미지/설정 변경으로 진행한다.
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

## dev 직접 조회 결과와 남은 확인 (2026-11-20)

사용자 요청으로 t2-dev-cp의 hostname·현재 컨텍스트를 확인한 뒤 kubectl get과 응답 상태 조회만 수행했다. Secret 값·SSH 개인키·DB 내용은 읽거나 출력하지 않았고, 생성·apply·Sync·삭제는 하지 않았다.

| 항목                  | 직접 확인한 상태                                                                                                  |
| --------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Gateway               | peakorder-gateway, ADDRESS 10.10.22.100, HTTP 80 listener 1개. TLS·hostname·인증서 참조 없음                      |
| HTTPRoute             | Auth 경로와 임시 gw-echo 경로가 존재. hostname 제한 없음                                                          |
| Auth Deployment       | 초기본 sha-317b6ee68bf4cba0f356b5ebdd19abfc02c715d0, Ready 1. DB/JWT 환경 변수 주입 없음                          |
| 프론트엔드 Deployment | peakorder에서 web-frontend가 조회되지 않음                                                                        |
| Auth Argo CD          | main·overlays/dev, automated 설정 없음, Synced·Healthy. 조회된 revision은 b5bc639                                 |
| 제안한 Secret         | auth-service-db·auth-service-runtime·auth-service-jwt가 조회되지 않음. 다른 이름의 Secret을 모두 조사한 것은 아님 |
| JWKS                  | dev Gateway HTTP /api/v1/auth/jwks 응답 404                                                                       |
| dev IP의 HTTPS        | https://10.10.22.100 연결 실패(curl exit 7, HTTP 000)                                                             |
| 외부 dev HTTPS 도메인 | Git 문서·Issue와 이번 조회에서 확정 근거를 찾지 못함. 외부 TLS 종료가 없다고 단정하지 않음                        |

Argo CD의 Git revision이 b5bc639로 표시돼도 실행 코드는 Deployment에 고정된 이미지 태그로 결정된다. 현재 초기본 이미지·수동 Sync·환경 변수 부재 상태에서 코드 병합만으로 V2가 자동 적용됐다고 간주하지 않는다. DB 담당의 승인 리뷰에 있는 자동 적용 예상은 실제 배포 설정과 구분한다.

DB 담당 NamGyuri는 [#164 리뷰](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/164#pullrequestreview-5987094069)에서 V2를 DB 범위로 승인했다. auth_dev라는 DB명은 해당 담당자 보고이며 이번 작업에서 DB 연결로 검증하지 않았다. ERD 보조 컬럼 반영과 만료·폐기 토큰 정리 시 expires_at 인덱스 검토는 후속 사항이며 원본 ERD를 수정하지 않았다.

### 실제 값 확정이 필요한 항목

| 담당           | 확인할 내용                                                 | 현재 상태                                          |
| -------------- | ----------------------------------------------------------- | -------------------------------------------------- |
| Gateway·프론트 | dev 외부 HTTPS 주소, 프론트/API 동일 출처, TLS 종료 위치    | 확인 근거 없음. prod 도메인을 임의 재사용하지 않음 |
| Auth·Gateway   | dev issuer·audience·kid와 JWKS 연결 주소                    | 기존 설정·논의에서 실제 값을 찾지 못함             |
| Auth·DB·운영   | Auth dev DB 접속 Secret 이름/키, 준비·주입 책임과 실행 승인 | DB 스키마 리뷰 승인 완료, 제안한 Secret은 없음     |
| Auth·운영      | 실제 JWT 키 생성·보관·Secret 주입 책임                      | 실제 키 생성·조회·등록하지 않음                    |
| Auth·프론트    | 실제 이용약관·개인정보 동의 버전                            | 테스트 버전을 실제 값으로 사용하지 않음            |

위 값은 추측으로 채우지 않는다. 실제 비밀번호·개인키는 댓글로 수집하지 않고 승인된 비공개 주입 경로로 처리한다. HTTPS/Origin·쿠키 조건을 맞추기 위해 Secure 속성을 끄는 우회도 하지 않는다.

### 이미지 게시 확인

병합 SHA `b5bc639f4f692a56b124545410b1468dd40b5b49`의 Auth 이미지 `ghcr.io/ktcloud-cloudnative-2026/team02-5xx/auth:sha-b5bc639f4f692a56b124545410b1468dd40b5b49`가 GHCR에 존재함을 확인했다. 플랫폼 linux/amd64, USER=app, OCI revision 라벨이 같은 SHA임을 확인했다. 현재 dev Overlay의 태그는 변경하지 않았다.

전체 main CI의 최종 판정은 [이미지 게시 실행](https://github.com/ktcloud-cloudnative-2026/team02-5xx/actions/runs/44669173529)에서 확인하고, 성공을 실제 활성화의 선행 조건으로 유지한다. 이미지 존재만으로 쿠키·DB·Gateway 연동까지 검증됐다고 표시하지 않는다.
