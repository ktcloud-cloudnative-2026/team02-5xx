# ME-05 메뉴 등록 — 제안 계약 및 로컬 검증

기준: [Issue #118](https://github.com/ktcloud-cloudnative-2026/team02-5xx/issues/118),
[API 수정 후 Menu 표](notion-draft.md), [ERD 메뉴 3-3](../erd/notion-draft.md),
기존 `V1__create_menu_tables.sql`, [CLAUDE.md](../../CLAUDE.md).

## 범위와 실제 인증 상태

`POST /api/v1/admin/menus`의 등록 업무 로직·DTO·HTTP·OpenAPI를 구현했습니다.
**#112 공통 계약은 미확정이며 실제 HTTP 요청은 기본 403 / FORBIDDEN입니다.**
실제 STORE_ADMIN 등록 201·비회원 401·CUSTOMER 403 연동은 미구현·미검증입니다.
아래 성공 응답 및 요청 오류 HTTP 검사는 테스트에서만 권한 경계를 모의했습니다.
이 구현을 보호된 관리자 API 전체 완료로 해석하지 않습니다.

`MenuCreateAuthorization.requireStoreAdmin()`은 요청 헤더·JWT·Servlet 신원·프로필·설정을 읽지 않고 항상 거부합니다.
Controller는 이 검사를 JSON 본문 읽기·검증·Service 호출보다 먼저 실행합니다.
권한 우회용 제품 설정·환경 변수·허용 bean을 추가하지 않았습니다.
잘못된 JSON·빈 본문도 JSON 미디어 타입의 등록 경로에 도달하면 기본 403입니다.
미디어 타입/Accept 등 MVC 경로 선택 단계의 415/406은 프레임워크 처리이며 이 경계의 403 보장과 구분합니다.

## 요청 계약 — 팀 확정 전 제안

새 의존성·Entity·Repository·DB·Flyway 변경 없이 기존 모델을 재사용합니다.
아래 세부 필수값·기본값·오류/응답 형식은 #118의 미결정 항목에 대한 **구현 제안**입니다.

| 필드 | 제안 정책 |
| --- | --- |
| categoryId | 필수, 양의 Long JSON 정수. 기존 카테고리가 있어야 함 |
| name | 필수, blank 불가, 최대 255 Unicode code point. 입력 앞뒤 공백을 임의 삭제하지 않음 |
| description | 선택, 생략/null 허용, PostgreSQL TEXT에 맞춰 별도 업무 길이 제한 없음 |
| imageUrl | 선택, 생략/null/빈 문자열 허용, 최대 255 code point. URL을 다운로드·검증·변환하지 않음 |
| basePrice, cookTimeSec | 필수, JSON 정수, 0 이상 2,147,483,647 이하 |
| status | 필수, ON_SALE / PAUSED / HIDDEN 정확한 대문자 enum. 자동 기본 상태 없음 |
| options | 생략/null/빈 배열은 옵션 0개. 배열 내부 null 항목 불가 |
| options[].name | 필수, blank 불가, 최대 255 code point |
| options[].extraPrice, extraCookTimeSec | 필수, JSON 정수, 0 이상 Integer.MAX_VALUE 이하 |
| options[].isDefault | 선택, 생략/null이면 false, 그 외 JSON boolean만 허용 |
| options[].active | 선택, 생략/null이면 true, 그 외 JSON boolean만 허용 |

문자열에는 PostgreSQL이 저장할 수 없는 NUL을 허용하지 않습니다.
숫자 문자열·소수·boolean의 숫자 변환, boolean 문자열, 알 수 없는 필드, 중복 JSON 키와 뒤따르는 JSON 문서를 거부합니다.
검증은 ME-05 전용 reader/DTO/Service 안에서 수행하며 공통 Jackson 설정과 MI-01·MI-02 정책은 바꾸지 않습니다.
Service 직접 호출에도 필수값·숫자 범위·문자열 길이·옵션 전체 사전 검증을 적용합니다.
255자 길이는 PostgreSQL varchar와 맞추기 위해 UTF-16 코드 단위 수 대신 Unicode code point 수로 계산합니다.

기존 모델에는 메뉴·옵션 이름의 유일성, 옵션 그룹 또는 기본 옵션의 유일 제약이 없습니다.
따라서 같은 이름, 여러 isDefault=true, 비활성 기본 옵션을 임의로 금지하지 않습니다.
자동 기본 옵션 생성·선택도 하지 않습니다. 단일/복수 선택·기본 옵션 개수 제한은 향후 팀 결정 사항입니다.
메뉴 상태와 옵션 active는 독립적이며 세 상태 모두 등록 가능합니다.

```json
{
  "categoryId": 1,
  "name": "치즈버거",
  "description": null,
  "imageUrl": null,
  "basePrice": 5500,
  "cookTimeSec": 90,
  "status": "PAUSED",
  "options": [
    {"name":"세트","extraPrice":2000,"extraCookTimeSec":30,"isDefault":false,"active":true}
  ]
}
```

## 저장·응답·오류

`AdminMenuCreateService.create()`의 단일 `@Transactional` 안에서 모든 입력을 검증한 뒤
CategoryRepository로 카테고리를 조회하고 MenuRepository.saveAndFlush 및 MenuOptionRepository.saveAllAndFlush로 저장합니다.
기존 identity·FK·NOT NULL·비음수 CHECK를 그대로 사용합니다. 옵션 저장/flush 실패도 메뉴와 앞선 옵션을 함께 롤백합니다.
DB 장애는 내부 오류로 전파하며 400이나 빈 성공으로 위장하지 않습니다.
카테고리가 조회 후 동시에 삭제되는 경쟁 등 DB 무결성 오류는 현재 500으로 매핑합니다.
Inventory 자동 생성·연결, 다른 MSA 호출, 재고·품절 처리, 쓰기 이벤트 발행은 없습니다.

권한 허용 후 성공 제안: **HTTP 201**, `{"success":true,"data":{"menuId":123},"message":"OK"}`.
상세 응답이나 Location 헤더는 추가하지 않습니다. 생성 시각은 기존 Entity/DB 정책을 사용합니다.

| 조건 | HTTP / errorCode |
| --- | --- |
| 실제 제품 실행 경로 | 403 / FORBIDDEN |
| 권한 허용 후 잘못된 JSON·입력 | 400 / INVALID_REQUEST |
| 권한 허용 후 없는 카테고리 | 404 / CATEGORY_NOT_FOUND |
| DB·그 외 내부 실패 | 500 / INTERNAL_ERROR |

기존 ApiResponse를 재사용하며 오류의 null data는 생략합니다.
응답/로그에 요청 본문·SQL·접속 정보·예외 원문을 노출하지 않습니다.
Swagger는 등록 API의 기본 차단 상태와 요청 필수값·기본값·201/400/403/404/500 계약을 명시합니다.

## #105·#117 통합 시 조치

브랜치는 `origin/feat/118-menu-admin-create`의 시작 커밋 `0d4c54f`에서 체크아웃했습니다.
조회 시 origin/main도 같은 커밋이었으며 로컬 main으로 전환하거나 다른 PR을 가져오지 않았습니다.
#117 Draft 및 #105는 미병합 상태입니다. 코드를 복사·merge하지 않았고 #108/#110 브랜치를 변경하지 않았습니다.

- 등록 Controller는 `AdminMenuCreateController`로 분리하고 POST 매핑만 소유합니다. #117의 조회 Controller와 URL은 같아도 HTTP Method가 다르므로 함께 등록할 수 있습니다. 합칠 경우 등록 로직은 별도 Service로 유지합니다.
- 현재 독립 기본 차단 bean `MenuCreateAuthorization`은 #117의 인증 경계를 가져오지 않기 위한 임시 분리입니다. 통합 시 하나의 공통 관리자 경계로 연결하고 이 bean을 제거합니다. #112 승인·실제 검증 전에는 허용 경로를 만들지 않습니다.
- 등록 전용 Advice는 Controller 범위로 한정됩니다. 인증 예외를 공통화할 때 중복 Advice/예외 매핑을 정리하고 기존 조회 오류 정책을 보존합니다.
- 기존 MenuServiceApplicationTests에는 CategoryRepository mock만 추가했습니다. #105/#117의 동일 mock 선언은 중복 없이 합칩니다. DB 자동 설정을 제외한 선행 HTTP 테스트도 새 등록 Service의 CategoryRepository 의존성을 mock해야 합니다.
- 고객 ME-01·02, 관리자 ME-03·04·05, MI-01·02 및 PostgreSQL 전체 회귀를 통합 후 다시 실행합니다. 현재 선행 조회 API 통합 회귀는 미검증입니다.
- #112 확정 후 실제 STORE_ADMIN 등록 201, 비회원/무효 토큰 401, CUSTOMER 403, Gateway 우회·직접 서비스 접근·헤더/JWT 위조 방지를 검증합니다.

인증·보안 및 API 계약 관점에서 향후 PR은 작성자 외 팀원 1명 승인과 CI 성공이 필요한 필수 리뷰 대상입니다.
이번 작업 범위는 로컬 구현·테스트·문서·커밋이며 Push·PR 생성·리뷰 요청·병합은 수행하지 않습니다.

## 검증 기록 (2026-11-19, Asia/Seoul)

Java 21.0.7 / 기존 Gradle 8.14.3·Spotless·formatter를 사용했습니다.
공유 개발 DB와 PostgreSQL 18 서비스는 변경하지 않았고 기존 PostgreSQL 16.16 바이너리로 TEMP 아래 새 전용 클러스터를 만들었습니다.
전용 DB `menu_118_isolated`·역할 `menu118_owner`와 실행 시 선택한 localhost 전용 포트를 사용합니다.
임시 비밀번호는 실행 프로세스 환경으로만 전달하고 초기화용 파일을 제거합니다.

```powershell
# 별도 격리 DB를 가리키는 MENU_DB_TEST_*를 지정한 상태에서 menu-service 디렉터리
.\gradlew.bat spotlessApply
.\gradlew.bat spotlessCheck test build --rerun-tasks --console=plain
git diff --check
```

첫 실행의 오류 주입용 mock 재설정 2건은 기존 answer를 stubbing 중 실행한 테스트 결함이었습니다.
doThrow 방식으로 수정했고 제품의 DB 실패 처리·실제 DB 롤백은 별도로 검증했습니다.
최종 실행 결과와 보존 상태는 아래에 기록합니다.

| 클래스 | 통과 | 실패·오류·생략 |
| --- | --- | --- |
| AdminMenuCreateDatabaseTests | 6 | 0 |
| AdminMenuCreateHttpTests | 22 | 0 |
| AdminMenuCreateDtoTests | 17 | 0 |
| MenuCreateAuthorizationTests | 5 | 0 |
| AdminMenuCreateServiceTests | 24 | 0 |
| 기존 MenuDatabaseTests | 35 | 0 |
| 기존 MenuServiceApplicationTests | 46 | 0 |
| 기존 MenuExistenceServiceTests | 9 | 0 |
| 기존 PurchaseValidationServiceTests | 23 | 0 |
| **전체** | **187** | **0** |

최종 PostgreSQL 16.16 서버는 `127.0.0.1:49310`에서 실행했고 검증 후 정상 종료 및 리스너 소멸을 확인했습니다.
**DB 검사는 합계 중 41건**입니다. 신규 6건은 세 상태 실제 commit·옵션/관계·255 code point·정수 경계,
미존재 카테고리, 두 번째 옵션의 실제 CHECK 오류 발생 시 메뉴와 첫 옵션의 롤백을 검증했습니다.
롤백 사례는 테스트 전용 Repository spy로 두 번째 옵션에 음수 금액을 주입하여 DB 오류를 유발합니다.
첫 옵션을 실제 persist/flush한 뒤 실패하며 Service 프록시의 트랜잭션 밖에서 잔여 메뉴/옵션 0행을 확인합니다.
일반 저장 사례는 실제 Spring Data Repository를 사용합니다. 공유 DB나 제품 인증 경계는 모의로 개방하지 않습니다.
Flyway V1 성공 및 전체 검증 종료 후 categories/menus/menu_options 각 0행도 별도 SQL로 확인했습니다.
Spotless·test·build는 BUILD SUCCESSFUL, 10개 task 실제 실행 결과입니다. staged diff를 포함한 공백 검사와 변경 범위 검사도 통과했습니다.

기존 #108 HEAD `237b2eb`, WIP `242765d`, #110 HEAD `7ce078d`는 그대로 보존했습니다.
작업 시작 기준 미추적 bin 117개와 기존 백업 4개, 총 121개 파일의 최종 해시 변화는 0건입니다.
bin을 편집·삭제·복구·스테이징하지 않았고 이전 Order bin 5개 변경·11개 추가를 임의 정리하지 않았습니다.
로그·DB 확인·해시 기준·XML 사본은 TEMP의 `peak118-834962c1d2ac440ba4aeac8c899e8db1`에 남겼습니다.
관련 변경은 Menu 제품 소스 7개, 신규 테스트 5개, 기존 회귀 테스트 mock 1개, README 및 이 문서의 총 15개 파일입니다.
실제 인증·선행 PR 통합·원격 CI는 위 로컬 통과 결과에 포함되지 않습니다.

### 최신 main 통합 후 Draft PR 제출 전 재검증 (2026-11-19)

fetch 후 최신 `origin/main`은 `fbe8118`(Cooking CI-03 취소 API, 6개 파일)이었습니다.
사전 merge-tree 검사 및 `git merge --no-edit origin/main`은 충돌 없이 성공했습니다.
통합 커밋은 `8dad14a1c00daefe4a284da9afd92eef4aa7f57e`이며 Menu 구현·테스트·제안 계약은 `8bd1549` 대비 동일합니다.
#105·#117은 조회 시 미병합이며 해당 코드를 복사하거나 통합하지 않았습니다.

새 임시 PostgreSQL 16.16 클러스터(`127.0.0.1:65067`, `menu_118_isolated`)에서 Java 21.0.7로
`spotlessCheck test build --rerun-tasks --console=plain`을 다시 실행했습니다.
XML 결과를 합산해 **187건 통과, 실패·오류·생략 0건**을 확인했습니다. 클래스별 건수는 위 표와 같습니다.
실제 PostgreSQL 41건, 원자적 저장·후속 옵션 실패 시 전체 롤백, HTTP/OpenAPI·실제 기본 403 및 MI-01·MI-02 회귀가 포함됩니다.
Gradle은 10개 task를 실제 실행해 BUILD SUCCESSFUL로 종료했습니다.
Flyway V1 성공 및 종료 전 세 업무 테이블 각 0행을 확인하고 임시 서버를 정상 종료했습니다. 전용 포트 리스너도 사라졌습니다.
공유 개발 DB는 변경하지 않았습니다.

이번 제출 단계 시작 기준 bin 117개·백업 4개의 해시 변화는 0건이며 #108 `237b2eb`, #110 `7ce078d`와 WIP `242765d`를 보존했습니다.
main 대상 전체 diff는 #118 관련 15개 파일이며 Cooking 변경·생성 파일·bin·백업은 포함하지 않습니다.
공백 검사와 변경 범위 검사 후 이 결과만 문서 커밋으로 추가합니다. 제품 구현·제안 사항을 확정 계약으로 변경하지 않습니다.
실행 로그·DB 확인·해시 기준·XML 사본은 TEMP의 `peak118-submit-8998fbcb95f546088357c13d5bfca0f9`에 남겼습니다.

이번 제출은 인증·선행 조회 PR 통합 미완료를 명시한 Draft PR까지입니다.
실제 STORE_ADMIN 201·비회원 401·CUSTOMER 403, #105/#117 통합 회귀, 원격 CI 성공은 이 로컬 결과로 대체하지 않습니다.
공통 인증 경계·예외 처리·테스트 mock 통합과 전체 회귀는 선행 계약/PR 통합 후 필요합니다.
