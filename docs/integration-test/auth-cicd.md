# Auth·CI/CD·GitOps 통합 테스트 — 이태훈

- 담당: Auth Service, CI/CD(GitHub Actions·GHCR), Argo CD·GitOps 배포, Auth 운영(HPA·관측성)
- 공동 테스트 주관: CT-02 인증·세션·권한·고객 간 정보 격리, CT-09 순차 배포·롤링 업데이트·롤백
- 상태 값: NOT RUN / IN PROGRESS / PASS / FAIL / BLOCKED / RETEST
- 이 문서는 테스트를 진행하면서 계속 갱신한다. 비밀번호·토큰·Secret 값은 기록하지 않는다(비밀번호는 `Read-Host -AsSecureString`으로만 입력).

## 테스트 환경

| 항목 | 값 |
|---|---|
| 환경 | dev (Gateway `10.10.22.100`, dev 도메인 `https://peakorder-dev.jpexstudio.com`, 서비스별 DB) |
| Auth 이미지 | `sha-6219d6bf419ca733376c317fcbc4bbbd4d38ba5b` (11/26 #369) |
| Auth 설정 | Access 900초(RS256), Refresh 쿠키 `peakorderRefreshToken`(HttpOnly·Secure·SameSite=Strict·Path=/api/v1/auth), Hikari 4/1, HPA min 1·max 3·CPU 70%, 시연용 약관 버전 `demo-v1`(dev만, #268) |
| 테스트 계정 | admin-demo(STORE_ADMIN), customer-demo(CUSTOMER) (#379, 비밀번호는 기록하지 않음). 비밀번호 변경·로그아웃 시험은 공용 계정이 아닌 별도 가입 계정으로 한다 |
| 공유 설정 변경 | 11/26 Auth 허용 Origin에 dev 도메인 추가(Secret `auth-service-runtime`의 `allowed-origins`, 값은 Git 밖) 후 Auth 재시작. Discord 공유 |
| 배포 기준 (11/26) | dev Application 7개 Synced/Healthy. auth·cooking·order·web-frontend `6219d6b`, menu `46d1801`, inventory `d0bba3d`, payment `5675838` |

## 1. Auth Service

| ID | 내용 | 상태 | 실제 결과 | 근거 | 일시 |
|---|---|---|---|---|---|
| A-01 | 회원가입·이메일 중복 확인·약관 동의(정상·누락·중복) | PASS | 정상 가입 2건(admin-demo id 4, customer-demo id 5, 약관 `demo-v1`) 201. 실패 경우(계정 생성 없음): 중복 이메일 409 `EMAIL_ALREADY_EXISTS`, 약관 누락 400 `REQUIRED_AGREEMENT_MISSING`, 약관 버전 틀림 400 `INVALID_AGREEMENT_VERSION`, 비밀번호 11자 400 `INVALID_REQUEST`. 이메일 중복 확인: 사용 중 `available=false`, 새 주소 `true`. 모두 Auth 등록 설계 문서의 오류 코드와 일치 | dev 도메인 경유 curl, #379 | 11/26 |
| A-02 | 로그인·내 정보 조회·닉네임 변경 | PASS | dev 도메인 경유 로그인 성공, 응답의 권한(CUSTOMER·STORE_ADMIN) 일치. 두 계정 모두 `GET /api/v1/auth/me` 200. 닉네임 변경(customer-demo): 변경 전 null, 공백만 400, 51자 400, `고객데모` 200 후 재조회 일치(공용 계정이라 의미 있는 값으로 유지) | 로그인·내 정보·`PATCH /api/v1/auth/me` 응답(토큰 값은 기록하지 않음) | 11/26 |
| A-03 | Access 만료 후 자동 재발급, 새로고침 시 로그인 유지(Refresh 쿠키) | NOT RUN | | 브라우저 확인(#287) | |
| A-04 | 로그아웃·비밀번호 변경 시 세션 폐기(다른 브라우저 포함) | NOT RUN | | 별도 가입 계정 사용 | |
| A-05 | Refresh 재사용 탐지·동시 재발급(한 번만 성공)·세션 전체 폐기 | NOT RUN | | | |
| A-06 | Origin 검사(dev 도메인·로컬 허용, 그 외 403), 쿠키 속성 | PASS | 로그인: 허용 안 된 Origin 403 `FORBIDDEN`, Origin·Referer 없음 403, dev 도메인 Origin은 검사 통과(없는 계정 401). 재발급: 허용 안 된 Origin 403. 로그인 응답 쿠키 `peakorderRefreshToken`: `Path=/api/v1/auth; Secure; HttpOnly; SameSite=Strict`(CUSTOMER·STORE_ADMIN 모두) | dev 도메인 경유 curl·PowerShell(쿠키 값은 기록하지 않음) | 11/26 |

## 2. 인증 연동 (Gateway·서비스)

| ID | 내용 | 상태 | 실제 결과 | 근거 | 일시 |
|---|---|---|---|---|---|
| G-01 | Gateway JWT 검증: 토큰 없음·만료·위조 토큰 401 | PASS | 토큰 없음 401, 위조 서명 토큰 401, 형식이 깨진 토큰 401 — Order 고객·Order·Menu·Inventory·Cooking 관리자 경로 모두(Gateway 응답, `/api/v1/auth/me`는 Auth 401). 만료 토큰: 17:13 발급 Access를 18분 뒤 사용 → `/api/v1/orders`·`/api/v1/admin/menus` 401(Gateway), `/api/v1/auth/me` 401 `UNAUTHORIZED`(Auth) | dev 도메인 경유 curl·PowerShell(토큰은 메모리 변수로만 쓰고 삭제), #394·#399 댓글 | 11/26 |
| G-02 | 위조 `X-User-Id`·`X-User-Role` 헤더 차단 | PASS | 토큰 없이 `X-User-Id: 4`·`X-User-Role: STORE_ADMIN`만 보내면 401 — Order 고객(`/api/v1/orders`)·Order·Menu·Inventory·Cooking(overview·queue) 관리자 경로 모두. 외부에서 `/internal/**`·`/actuator/**`는 404 | dev 도메인 경유 curl, #394·#399 댓글, #411 O-06 | 11/26 |
| G-03 | 고객 토큰의 사용자 정보가 Order·Payment에 올바르게 전달, 고객 간 정보 격리 | NOT RUN | | CT-02와 함께 진행(영업 켬 11/26 14:19 이후 가능) | |
| G-04 | 관리자 API 권한: 고객 403, 관리자 200 | PASS | CUSTOMER 403, STORE_ADMIN 200 — Menu(`/api/v1/admin/menus`)·Order(`/api/v1/admin/store/operations`)·Inventory(`/api/v1/admin/inventory/items`)·Cooking(`/api/v1/admin/cooking/overview`, `/queue`) 모두 | dev 도메인 경유 PowerShell(비밀번호는 `Read-Host`로만 입력), #394·#399 댓글 | 11/26 |
| G-05 | 프론트 401 처리(재발급 후 재시도, 실패 시 로그인 화면) | NOT RUN | | 브라우저 확인, 이은제와 함께 | |

## 3. CI/CD

| ID | 내용 | 상태 | 실제 결과 | 근거 | 일시 |
|---|---|---|---|---|---|
| C-01 | PR 검사(빌드·테스트·포맷·이미지 빌드) 및 CI Final 판정 | NOT RUN | | | |
| C-02 | main 병합 → GHCR 이미지 게시 → dev 태그 PR 자동 생성 | PASS(관찰) | 병합마다 GHCR 이미지 게시 후 자동 태그 PR 생성 확인(#364, #390·#391·#394). 한계: main 병합마다 열린 자동 PR을 새 PR로 대체함(배포 파일만 바꾼 병합 포함) — 후속 개선 대상 | Actions 실행 기록, 자동 PR | 11/26 |
| C-03 | 결함 수정 시 수정 PR → CI → 태그 PR → dev 반영 재배포 경로와 소요 시간 | NOT RUN | | 첫 결함 수정 때 측정 | |

## 4. Argo CD·GitOps

| ID | 내용 | 상태 | 실제 결과 | 근거 | 일시 |
|---|---|---|---|---|---|
| D-01 | dev Application 7개 Synced/Healthy, 배포 이미지와 main 일치 | PASS | 7개 모두 Synced/Healthy, 각 Deployment 이미지가 main의 dev overlay 태그와 일치(테스트 환경 표 참고) | `kubectl get applications`, `get deploy` | 11/26 |
| D-02 | HPA 확대·축소 시 Argo CD가 Pod 수를 되돌리지 않음(ignoreDifferences) | NOT RUN | | CT-07(김민규) 부하 시 함께 관찰 | |
| D-03 | Auth Pod 재시작·재생성 중 로그인 유지, Probe·정상 종료 | NOT RUN | 11/26 허용 Origin 변경 재시작에서 새 Pod Ready·재시작 0 확인(로그인 유지는 미확인) | | |
| D-04 | 태그 PR 되돌리기로 이전 이미지 복구(롤백)와 소요 시간 | NOT RUN | | CT-09에서 진행 | |
| D-05 | Auth 지표(`/actuator/prometheus`)·ECS 로그·알림 | IN PROGRESS | monitoring namespace에서 Auth `/actuator/prometheus` 200 확인(#401 사전 확인). ServiceMonitor는 #401 병합·적용 후 확인 | #401 | 11/26 |

## 5. 서비스 간 공동 검증

| ID | 내용 | 상태 | 실제 결과 | 근거 | 일시 |
|---|---|---|---|---|---|
| J-01 | 로그인 → 메뉴 → 주문 → 결제 → 조리 완료 전체 흐름의 사용자 연결 | NOT RUN | | CT-01(이은제) | |
| J-02 | 여러 Pod일 때 로그인·재발급·주문 동작 및 DB 연결 수(Pod당 4) | NOT RUN | | CT-07(김민규) | |
| J-03 | 동시 배포 금지 상태에서의 순차 재배포 | PASS | 묶음 태그 PR(#364)을 서비스별 PR로 나눠 web-frontend(#368) → auth(#369) → cooking(#370) → order(#371) 순서로 하나씩 병합, 각각 Synced/Healthy·새 Pod Ready·재시작 0 확인 후 다음 진행 | #368~#371 댓글, #186 | 11/26 |

## 6. 공동 테스트 (주관)

| ID | 내용 | 상태 | 비고 |
|---|---|---|---|
| CT-02 | 인증·세션·권한·고객 간 정보 격리 | IN PROGRESS | 11/26 완료: 가입·닉네임·Origin·쿠키 속성(A-01·A-02·A-06), 잘못된·만료 토큰(G-01), 위조 헤더 차단(G-02), 관리자 권한 5개 서비스 경로(G-04). 남음: 세션 폐기·재사용 탐지(A-04·A-05), 고객 간 격리(G-03). A·G 항목 결과를 모은다. 공유 환경을 바꾸지 않아 다른 테스트와 병행 가능. 고객 간 격리는 고객 계정 2개로 서로의 주문 조회가 막히는지 확인(김민규 O-03과 근거 공유). 관리자 권한은 각 서비스 담당과 결과 확인 |
| CT-09 | 순차 배포·롤링 업데이트·롤백 | IN PROGRESS | 순차 재배포는 J-03으로 확인. 롤링·롤백은 11/30 오후 결함 수정·재배포 시간에 맞춰 시작 전 Discord 공지 후 진행. 한 번에 한 서비스만 바꾸고(#186), 롤백도 Git 되돌림 PR → Argo CD로만 한다(`kubectl` 직접 변경 금지). 김민규 CT-07 부하 시간과 겹치지 않게 한다. 끝나면 원래 버전으로 복원 |

## 7. prod 확인

| ID | 내용 | 상태 | 실제 결과 | 근거 | 일시 |
|---|---|---|---|---|---|
| P-01 | prod 배포 준비 상태(Argo CD 설치·Secret·SecurityPolicy) 점검 | IN PROGRESS | 읽기 전용 확인: 노드 3개 Ready, Argo CD 미설치, 워크로드·Secret·NetworkPolicy 없음, Gateway `10.10.22.200` Programmed·HTTPRoute 없음. prod 진행 여부는 팀 결정 대기 | `kubectl get` (prod, 조회만) | 11/26 |

## 8. 최종 회귀 테스트

| ID | 내용 | 상태 | 실제 결과 | 근거 | 일시 |
|---|---|---|---|---|---|
| R-01 | 결함 수정·재배포 후 로그인·권한·주문 핵심 흐름 재검증 | NOT RUN | | 12/1 오전 | |

## 관련 이슈·PR

- #186 (동시 롤링 제한), #268 (약관 버전), #287 (브라우저 검증), #379 (시연 계정)
- #364, #368~#371 (서비스별 순차 태그 반영)
- #390·#391·#394 (Menu 태그 반영·관리자 권한 확인), #398·#399 (Order 관리자 API)
- #401 (ServiceMonitor)
- #413 (이 문서)
