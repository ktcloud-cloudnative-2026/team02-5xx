# Auth 서비스 배포

Auth를 기존 GitHub Actions 이미지와 Argo CD에 연결한다. Java 21·Spring Boot 설정과 서비스 코드는 서비스 디렉터리에서 관리한다.

## 구조와 현재 검증 범위

`base/`는 Deployment·ClusterIP Service·Auth HTTPRoute를 각 1개 정의한다. `overlays/dev/`와 `overlays/prod/`는 환경별 이미지 버전을 관리한다. 애플리케이션 리소스의 namespace는 `peakorder`이고 `app: auth-service`, `team: team02` 라벨을 사용한다.

초기 이미지는 GHCR 게시가 확인된 `ghcr.io/ktcloud-cloudnative-2026/team02-5xx/auth:sha-317b6ee68bf4cba0f356b5ebdd19abfc02c715d0`이다. 각 환경 Overlay의 `images.newTag`를 갱신한다.

Auth 초기본은 8080 포트와 `/v3/api-docs`, `/swagger-ui/index.html`을 제공한다. 시작·준비·생존 검사는 기존 OpenAPI 응답을 사용한다. DB 설정은 초기본의 의존성과 실행 설정에 포함돼 있지 않다. dev 세션 활성화 변경과 선행 조건은 아래를 따른다.

## 로컬 확인

```bash
kubectl kustomize deploy/apps/auth-service/base
kubectl kustomize deploy/apps/auth-service/overlays/dev
kubectl kustomize deploy/apps/auth-service/overlays/prod
```

dev 환경에서 아래 명령은 설정 검증에 사용한다.

```bash
kubectl apply --dry-run=server -k deploy/apps/auth-service/overlays/dev
```

## Pod 수 관리(HPA 준비) — Issue #344

- Argo CD Application(`deploy/argocd/dev/auth-service.yaml`)은 Deployment의 `/spec/replicas`를 비교에서 제외하고 `RespectIgnoreDifferences=true`로 Sync가 그 값을 되돌리지 않게 한다(Order #204와 같은 방식, 자동 동기화 설정은 그대로). 이후 HPA가 Pod 수를 정하거나 2 Pod 시험을 위해 수동으로 늘려도 Sync가 Git의 `replicas: 1`로 되돌리지 않는다.
- 이 파일은 Argo CD가 관리하지 않아, 바꾸면 dev에서 `kubectl apply -f deploy/argocd/dev/auth-service.yaml`로 다시 적용해야 반영된다.
- 종료 보호(`preStop` 10초, `terminationGracePeriodSeconds` 50초)는 #325에서 반영돼 있다. HPA와 2 Pod 시험은 이슈 #344에서 이어서 진행한다.

## 자동 확장(HPA, dev) — Issue #344

- `overlays/dev/hpa.yaml`의 HorizontalPodAutoscaler가 CPU 사용률 평균 70%(requests 100m 기준 약 70m)를 목표로 Pod를 1개에서 3개까지 조절한다(이슈 #344, #186 합의값). prod에는 없다.
- Pod 수는 HPA가 정하고, Application의 `ignoreDifferences`(`/spec/replicas`)와 `RespectIgnoreDifferences`가 Sync가 Git의 `replicas: 1`로 되돌리지 않게 한다(위 "Pod 수 관리"). Git의 `replicas: 1`은 HPA가 없을 때의 값이다.
- 축소는 쿠버네티스 기본 안정화(5분)를 따른다. 줄어드는 Pod는 `preStop`(10초)과 `terminationGracePeriodSeconds`(50초)로 요청을 보호한다(#325).
- 확대하면 Pod당 DB 연결이 최대 4개라 서비스당 최대 12개(3 × 4)이고, 롤링 중 임시 Pod를 포함한 전체 예산은 최대 96이다(일반 연결 97, #186). 여러 서비스를 동시에 롤링하지 않는다.
- 2 Pod 시험(2026-11-25, dev, 시험용 계정, Pod마다 port-forward와 `Origin` 헤더로 직접 호출): 두 Pod의 JWKS가 같고(`kid auth-dev-01`, 응답 해시 동일), Pod A에서 로그인해 받은 토큰을 Pod B가 검증했으며(`/me` 200), 같은 갱신(refresh) 쿠키를 두 Pod에 동시에 보내면 `200`이 정확히 한 개이고 나머지는 `401`이었다(사용자 행 잠금과 재사용 감지로 세션 폐기, 설계된 동작). 결과는 이슈 #344 댓글에 있다.
- 로그인(Argon2id 비밀번호 해시)은 CPU를 많이 쓴다. 코드상 비밀번호 검증은 사용자 행을 잠그기 전에 트랜잭션 밖에서 하므로 같은 계정으로 동시에 로그인해도 CPU 작업은 병렬로 돌고, 잠금은 그 뒤 토큰 저장 구간에만 걸린다. 부하 시험을 마쳤다(확대 1 → 3, 오류 0%, 축소 3 → 1). requests 100m·목표 70%는 시작값을 그대로 유지한다. 결과는 이슈 #186 댓글에 있다.
- 확인: `kubectl -n peakorder get hpa auth-service`로 현재 사용률(TARGETS)과 Pod 수를 본다. 사용률이 `<unknown>`이면 CPU 지표를 아직 읽지 못한 것이다. 원인은 Pod의 CPU requests 미설정, Pod가 아직 Ready가 아니거나 기동 직후 지표 수집 지연, metrics-server 이상 등일 수 있으므로 `kubectl -n peakorder describe hpa auth-service`의 Conditions·Events와 `kubectl -n peakorder top pod`로 원인을 좁힌다.

## 이미지 갱신과 복구

1. main GitHub Actions의 코드 검사·이미지 게시·CI Final 성공을 확인한다.
2. GHCR에 존재하는 전체 커밋 SHA 태그를 확인한다.
3. 별도 Issue와 브랜치에서 대상 환경의 `images.newTag`만 변경한다.
4. PR에 이미지 SHA와 검증 결과를 기록하고 작성자 외 팀원 1명 승인을 받는다.
5. 병합 후 [Argo CD 절차](../../argocd/README.md)에 따라 대상 환경을 동기화한다.
6. 문제가 있으면 해당 환경 태그를 검증된 이전 SHA로 돌리는 PR을 만들고 같은 리뷰·동기화 절차를 따른다.

prod Overlay는 환경별 이미지 버전을 구분하는 초기 구성을 제공한다. prod Application과 실제 배포, 운영 복제본·자원·승인·자동 동기화 정책은 후속 협의 항목이다. 초기 단일 복제본은 첫 dev 실행 검증을 위한 구성이다.

서비스에 DB·인증 정책이나 OpenAPI 접근 제어가 추가되면 필요한 Secret 참조 및 검사 경로를 함께 검토한다. 비밀값은 Git과 로그에 기록하지 않는다.

## dev 세션·JWKS 활성화 — Issue #180

**2026-11-23 상태: PR #181 승인·병합 및 dev 수동 Sync 완료. Argo CD Synced·Healthy, 최신 Auth Pod Ready·재시작 0, Flyway V1·V2와 Gateway JWKS 200 확인. 아래 준비 체크리스트는 작성 당시 절차이며 실제 결과와 남은 연동 항목은 [Auth 계약·검증 현황](../../../docs/api/auth-session-contract.md) 및 [PR #181 배포 기록](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/181)을 따른다.**

`overlays/dev/session-patch.yaml`은 [준비 PR #175](https://github.com/ktcloud-cloudnative-2026/team02-5xx/pull/175)의 서버/JWKS 후보를 재사용한다. dev에만 연결하고 이미지 태그를 게시가 확인된 `sha-b5bc639f4f692a56b124545410b1468dd40b5b49`로 고정한다. base·prod의 초기 이미지, Service·HTTPRoute·Argo CD Application은 변경하지 않는다. #175는 준비 후보 PR이고 이 변경은 실제 dev 연결 PR이다.

### 필요한 외부 설정

| Secret 이름            | 필수 키                                           | 용도                                                       |
| ---------------------- | ------------------------------------------------- | ---------------------------------------------------------- |
| `auth-service-db`      | `DB_URL`, `DB_USER`, `DB_PASSWORD`                | Auth 소유 dev DB 연결                                      |
| `auth-service-runtime` | `issuer`, `audience`, `key-id`, `allowed-origins` | Auth·Gateway 간 확인한 발급자·검증 대상·kid 및 허용 Origin |
| `auth-service-jwt`     | `private-key.pem`, `public-key.pem`               | 대응하는 RSA PKCS#8 개인키·X.509 공개키, 2048비트 이상     |

이름·키는 연결 후보 기준이며 실제 존재·값의 유효성을 검증한 것은 아니다. 다른 서비스의 DB·키를 재사용하지 않는다. 실제 값은 담당자가 승인된 비공개 경로로 준비하며 Git·댓글·로그·명령 인수에 비밀번호나 키 원문을 남기지 않는다. 이 변경은 Secret 리소스를 만들거나 AppProject 권한을 넓히지 않는다.

환경 변수는 서버 설정 12개를 주입한다. `AUTH_SESSION_ENABLED=true`, DB 연결 3개, issuer/audience/kid/Origin 4개, 키 파일 경로 2개, Hikari 풀 설정 2개다. 키는 readOnly·0440·`fsGroup: 2000`으로 주입하며 실제 이미지 사용자의 읽기 가능 여부와 키 대응을 확인해야 한다.

DB 담당이 [#112 답변](https://github.com/ktcloud-cloudnative-2026/team02-5xx/issues/112#issuecomment-7088497126)에서 Secret 이름·키와 Auth dev 접속 정보에 동의했고, Secret 생성은 비밀번호를 관리하는 DB 담당이 직접 수행한다. 생성 완료 전에는 준비됐다고 표시하지 않는다. [#186](https://github.com/ktcloud-cloudnative-2026/team02-5xx/issues/186)의 DB 연결 수 예산에 따라 dev에만 `SPRING_DATASOURCE_HIKARI_MAXIMUM_POOL_SIZE="4"`, `SPRING_DATASOURCE_HIKARI_MINIMUM_IDLE="1"`을 적용한다. 이는 HPA·공통 자원 제한·prod DB 설정 변경을 포함하지 않는다.

**2026-11-24 갱신(#268):** dev에만 `AUTH_TERMS_VERSION`·`AUTH_PRIVACY_VERSION`=`demo-v1`을 넣어 회원가입을 연다. `demo-v1`은 프론트 회원가입(#258)과 맞춘 **dev 시연용 약관 버전**이며 prod에는 넣지 않는다. prod는 실제 약관 문구·버전이 정해질 때까지 `REGISTRATION_UNAVAILABLE`을 유지한다. dev Gateway는 HTTP이므로 팀원은 실제로 쓰는 비밀번호가 아닌 시험용 비밀번호만 사용한다. HTTPS 경로는 #112 후속 작업으로 남긴다.

(이전 기록) `AUTH_TERMS_VERSION`·`AUTH_PRIVACY_VERSION`은 포함하지 않는다. 실제 약관 버전 없이 회원가입은 기존 `REGISTRATION_UNAVAILABLE` 정책을 유지한다. **세션 기능이 켜지면 로그인·재발급 등도 구현상 활성화되므로 공개 JWKS만 켜지는 설정은 아니다.** 현재 HTTPRoute의 `/api/v1/auth` 전체 노출을 그대로 승인한 것으로 보지 않는다. 실제 활성화 전에 Gateway 담당과 HTTP 업무 경로 노출 제한 또는 합의한 HTTPS 경로를 확인한다. HTTP로 실제 비밀번호·쿠키·토큰을 주고받는 검증은 하지 않는다.

### 병합 전 확인

- [ ] #175 준비 변경과 이 연결 변경에 대한 검토 의견 반영, 이 PR의 CI 통과 및 작성자 외 팀원 1명 승인
- [ ] Auth dev DB Secret 준비, DB 담당의 현재 Flyway 이력·V2 적용·백업/복구 확인
- [ ] 실제 JWT 키 생성·보관·주입 책임과 Secret 준비, 키 파일 접근 확인
- [ ] [#112](https://github.com/ktcloud-cloudnative-2026/team02-5xx/issues/112)의 issuer/audience/kid/허용 Origin 및 Gateway JWKS 취득 방식 확인
- [ ] HTTP 업무 경로의 노출 방침 확인; 브라우저 인증 연동은 별도 HTTPS 환경에서 검증

확인되지 않은 값을 임의로 채우지 않는다. 새 이미지가 DB에 연결해 기동하면 `AUTH_SESSION_ENABLED=false`여도 Flyway V2는 적용 대상이다. 기능 플래그를 DB 변경 승인 대신 사용하지 않는다.

### 승인·병합 후 적용과 검증

1. `t2-dev-cp` hostname·dev 컨텍스트를 확인하고 기존 `auth-service-dev` Argo CD Diff에서 Auth dev 변경만 있는지 확인한다.
2. Git PR → Argo CD 경로로 **수동 Sync**한다. Deployment 직접 apply·자동 Sync 정책 변경은 하지 않는다.
3. 실제 이미지 SHA, Pod Ready, 설정 바인딩·키 접근·Flyway 오류 여부와 V2 적용 결과를 확인한다. 로그 전체나 토큰·비밀번호를 출력하지 않는다.
4. 내부 Service와 Gateway 경유 `GET /api/v1/auth/jwks`의 200, 기대한 kid와 공개 RSA 키를 확인한다. 개인키 필드가 없어야 한다. HTTP 공개 응답 확인만으로 Gateway JWT 검증까지 성공했다고 표시하지 않는다.
5. 검증한 JWKS·issuer/audience/kid·이미지 SHA를 Gateway 담당에게 전달한다. Gateway JWT 검증·신원 헤더·우회 차단·각 서비스의 관리자 권한 검사는 별도 연동 검증이다.

문제가 생기면 dev Overlay의 이미지와 설정을 함께 직전 검증 상태로 되돌리는 Git PR을 만들고 승인 후 Argo CD로 반영한다. 이미지 태그만 복구하면 새 설정이 남으므로 이미지 복구만으로 호환성이 보장된다고 보지 않는다. V2 테이블 삭제·수동 DDL·자동 역마이그레이션은 하지 않는다. DB 복구는 담당자 확인 후 별도 절차를 따른다.

prod Overlay와 prod Gateway `10.10.22.200`은 이번 작업에서 변경·삭제·재생성하지 않는다. HTTPS 브라우저 쿠키 저장·회전·삭제·다중 탭 및 실제 회원가입·로그인 연동은 아직 검증하지 않았다.
