# ME-06 메뉴 정보·옵션 수정 — 제안 계약

기준: [Issue #120](https://github.com/ktcloud-cloudnative-2026/team02-5xx/issues/120),
[API 수정 후 Menu 표](notion-draft.md), [메뉴 ERD 3-3](../erd/notion-draft.md),
기존 Flyway V1 및 [CLAUDE.md](../../CLAUDE.md).
아래 PATCH 세부 정책·응답·오류는 **팀 확정 전 구현 제안**입니다.

## 범위와 인증 상태

`PATCH /api/v1/admin/menus/{menuId}`로 메뉴 정보·옵션을 수정합니다.
**ME-07 판매 상태 변경과 Inventory 재고·품절·연결은 구현하지 않습니다.**
`status` 등 범위 밖 필드는 거부하며 기존 판매 상태를 유지합니다.

#112 공통 인증 계약 미확정으로 실제 HTTP는 **기본 403 / FORBIDDEN**입니다.
`MenuUpdateAuthorization.requireStoreAdmin()`은 헤더·JWT·Servlet 신원·프로필·환경 변수를 신뢰하지 않고 항상 거부합니다.
Controller에서 ID 변환·JSON 본문 읽기·Service 호출보다 먼저 권한 경계를 실행합니다.
미디어 타입/Accept 등 MVC 경로 선택 단계의 415/406은 프레임워크 동작과 구분합니다.
실제 STORE_ADMIN 200·비회원 401·CUSTOMER 403은 미구현·미검증입니다.
정상/입력 오류 HTTP 테스트에서만 권한 판정을 모의하며 이를 실제 인증 성공으로 표시하지 않습니다.

## 필드별 부분 수정

`Content-Type: application/json`을 사용합니다. 배열이 항목별 변경 명령이므로 표준 JSON Merge Patch 전체 교체 의미를 주장하지 않습니다.
모든 필드는 **생략하면 기존 값 유지**입니다. 빈 객체나 실제 수정 항목이 없는 요청은 400입니다.

| 필드 | 전달 시 정책 | 명시적 null |
| --- | --- | --- |
| name | blank 불가, 최대 255 Unicode code point. 앞뒤 공백 보존 | 400 |
| categoryId | 양의 Long JSON 정수, 기존 카테고리 필요 | 400 |
| description | TEXT 문자열, 업무 길이 제한 없음 | 기존 설명 제거 |
| imageUrl | 문자열, 빈 문자열 허용, 최대 255 code point | 기존 이미지 주소 제거 |
| basePrice, cookTimeSec | 0~2,147,483,647 JSON 정수 | 400 |
| options | 아래 항목별 수정/추가 배열 | 400 |

문자열 NUL, 잘못된 JSON 타입·정수 범위·소수·숫자 문자열·알 수 없는 필드·중복 키·후행 JSON을 거부합니다.
검증은 ME-06 전용 DTO/reader 안에 한정하며 기존 Jackson 전역 설정과 MI-01·MI-02 입력 정책을 변경하지 않습니다.
presence와 null을 구분하는 검증된 문서를 복사 보관하고 외부에서 내용을 바꾸지 못하도록 반환 시에도 복사합니다.
같은 값을 명시한 유효한 변경은 허용하며 메뉴 updatedAt을 갱신합니다.

## 옵션 배열은 전체 교체가 아닌 항목별 변경

- options 생략: 모든 옵션 유지.
- options `[]`: 옵션 변경 없음. 다른 메뉴 필드가 있으면 허용하지만 `{"options":[]}` 단독은 빈 변경으로 400.
- **배열에 없는 기존 옵션은 유지**합니다. 묵시적인 비활성화·삭제·ID 재발급은 하지 않습니다.
- optionId가 있으면 해당 메뉴 소유의 기존 옵션을 수정합니다. 양의 Long만 허용하며 같은 ID 중복은 400입니다.
- 기존 옵션에는 적어도 하나의 수정 필드가 필요합니다. optionId만 있는 항목은 400입니다.
- 존재하지 않는 옵션과 다른 메뉴의 옵션은 모두 404 OPTION_NOT_FOUND로 처리합니다. 다른 메뉴의 옵션을 재연결하지 않습니다.
- optionId가 **생략**되면 새 옵션을 추가합니다. 명시적 null ID는 400입니다.
- 신규 옵션은 name·extraPrice·extraCookTimeSec 필수이며 isDefault 생략 시 false, active 생략 시 true입니다.
- 기존 옵션의 각 필드 생략은 유지입니다. name·추가 가격/시간·isDefault·active의 명시적 null은 신규/기존 모두 400입니다.
- name은 blank 불가·최대 255 code point, 추가 가격/시간은 0~Integer.MAX_VALUE JSON 정수, 플래그는 JSON boolean입니다.
- `active:false`로 기존 옵션을 비활성화하며 `active:true` 재활성화도 허용합니다. 기존 optionId는 그대로 유지합니다.
- isDefault와 active는 독립입니다. 모델에 없는 단일 기본 옵션·이름 유일성 제약을 추가하거나 다른 옵션의 플래그를 자동 변경하지 않습니다.
- 신규 옵션 추가를 포함한 요청 재전송은 또 다른 옵션을 만들 수 있습니다. idempotency key·조건부 갱신 계약은 구현하지 않았습니다.

```json
{
  "name": "치즈버거",
  "description": null,
  "basePrice": 5500,
  "options": [
    {"optionId": 12, "extraPrice": 2000, "active": false},
    {"name": "새 세트", "extraPrice": 2500, "extraCookTimeSec": 30}
  ]
}
```

## 저장·시각·동시성

MenuUpdateService의 단일 `@Transactional` 안에서 대상 메뉴를 PESSIMISTIC_WRITE로 잠급니다.
카테고리와 모든 기존 옵션의 존재·소유권을 먼저 확인한 뒤 Entity의 정보 변경 메서드로 수정합니다.
기존 Menu·MenuOption ID와 메뉴 createdAt·status·옵션의 부모 연결은 유지합니다.
Entity에는 정보 수정용 메서드만 추가했고 status 변경 메서드·매핑·스키마 변경은 없습니다.
옵션 저장/flush와 메뉴 flush를 같은 트랜잭션에서 수행해 DB 실패 시 모두 롤백합니다.
옵션만 수정한 경우에도 부모 메뉴 updatedAt을 갱신하며 기존 @PreUpdate 정책을 유지합니다.

동일 메뉴에 대한 **이 ME-06 경로의 동시 PATCH는 부모 행 잠금으로 직렬화**하고,
뒤 요청은 잠금 획득 후 최신 데이터를 읽어 생략 필드가 앞 요청의 값을 덮어쓰지 않게 합니다.
DB 테스트는 실제 두 트랜잭션과 pg_stat_activity의 Lock 대기를 확인하고 이름/가격 두 변경이 모두 남는지 검증합니다.
서로 다른 코드 경로·외부 DB writer의 변경까지 보호한다고 주장하지 않습니다. 향후 ME-07/기타 쓰기도 동일 잠금 규칙을 검토해야 합니다.
클라이언트가 같은 필드를 변경하면 뒤 요청 값이 적용됩니다. 버전 컬럼·ETag·If-Match·낙관적 충돌 탐지는 추가하지 않았습니다.
카테고리 동시 삭제 등의 FK 경쟁·교착/잠금 오류는 현재 500으로 처리하고 트랜잭션을 롤백합니다. 자동 재시도는 없습니다.

## 응답·오류·OpenAPI

성공 제안: **200**, `{"success":true,"data":{"menuId":123},"message":"OK"}`.
신규 옵션 ID는 기존 조회 API 통합 후 조회할 수 있으며 이 응답은 전체 상세나 옵션 ID 목록을 반환하지 않습니다.

| 조건 | HTTP / errorCode |
| --- | --- |
| 실제 제품 실행 경로 | 403 / FORBIDDEN |
| 권한 허용 후 잘못된 ID·입력·빈 변경 | 400 / INVALID_REQUEST |
| 미존재 메뉴 | 404 / MENU_NOT_FOUND |
| 미존재 카테고리 | 404 / CATEGORY_NOT_FOUND |
| 미존재 또는 다른 메뉴의 옵션 | 404 / OPTION_NOT_FOUND |
| DB 및 그 외 내부 실패 | 500 / INTERNAL_ERROR |

기존 ApiResponse와 camelCase를 재사용하며 오류의 null data는 생략합니다.
오류 응답·로그에 SQL·접속 정보·예외 원문·요청 본문을 기록하지 않습니다.
OpenAPI에는 기본 차단, PATCH 존재 여부 규칙, 옵션 항목별 처리, 요청/성공 스키마와 400/403/404/500을 명시합니다.

## 선행 PR 통합 시 중복·충돌

시작 시 fetch 후 main과 원격 #120 시작점은 `fbe8118`이었습니다. 로컬 main으로 전환하지 않았습니다.
#105·#117·#119는 조회 시 미병합이며 코드를 복사·merge하거나 브랜치를 수정하지 않았습니다.

- MenuUpdateController는 PATCH만 소유합니다. 조회 GET·등록 POST와 함께 유지할 수 있으므로 하나의 거대 Controller로 합칠 필요는 없습니다.
- 현재 MenuUpdateAuthorization은 독립 기본 차단 경계입니다. #117/#119 통합 시 공통 관리자 권한 경계 하나로 연결하고 임시 경계 bean들을 정리해야 합니다. #112 확정 전에는 허용하지 않습니다.
- MenuUpdateExceptionHandler는 해당 Controller 범위로 한정합니다. 공통 인증 예외·Advice를 연결할 때 중복 처리 우선순위를 정리하고 각 업무의 오류 계약을 보존해야 합니다.
- 새 Repository 잠금 메서드는 기존 조회·등록 메서드와 공존합니다. 조회 PR의 Repository 확장도 보존하며 이후 모든 쓰기 경로에 잠금 규칙 적용 여부를 검토해야 합니다.
- 기존 HTTP 회귀 테스트에는 CategoryRepository mock만 추가했습니다. 선행 PR의 같은 선언을 중복 없이 합치고 DB 제외 컨텍스트에 새 Service 의존성을 충족시켜야 합니다.
- 등록용 기본값 처리와 PATCH의 존재 여부를 구분해야 합니다. #119의 등록 제안에서 플래그 null을 기본값으로 처리하더라도 여기서는 null을 오류로 유지하므로 등록 DTO를 그대로 재사용하지 않습니다.
- #105/#117/#119 통합 뒤 ME-01~06 및 MI-01·MI-02·PostgreSQL 전체 회귀가 필요합니다. 현재 조회·등록과의 통합 회귀는 미검증입니다.
- #112 합의 후 실제 STORE_ADMIN 200·비회원 401·CUSTOMER 403, 직접 Service 호출·Gateway 우회·헤더/JWT 위조 방지 검증이 필요합니다.

API 계약·인증·보안 변경의 필수 외부 리뷰와 원격 CI는 향후 제출 단계의 조건입니다.
이번 작업은 로컬 구현·검증·문서·커밋까지만 수행하며 Push·PR 생성·리뷰 요청·승인·병합은 하지 않습니다.
미완료 인증과 통합 한계를 명시한 Draft PR 제출 자료로 사용할 수 있으나 Issue 전체 완료로 간주하지 않습니다.

## 실제 로컬 검증 (2026-11-19, Asia/Seoul)

Java 21.0.7 / Gradle 8.14.3 / 기존 Spotless·formatter를 사용했습니다.
기존 PostgreSQL 16.16 바이너리로 TEMP 아래 새 전용 data 디렉터리를 initdb로 생성했습니다.
전용 서버 `127.0.0.1:58835`, DB `menu_120_isolated`, 역할 `menu120_owner`를 사용했습니다.
임시 비밀번호를 프로세스 환경에만 주입했고 초기화용 파일을 제거했습니다. 공유 개발 DB와 PostgreSQL 18 서비스는 변경하지 않았습니다.

```powershell
# menu-service, 격리 DB 전용 MENU_DB_TEST_* 설정 상태
.\gradlew.bat spotlessApply
.\gradlew.bat spotlessCheck test build --rerun-tasks --console=plain
git diff --check
```

| 클래스 | 통과 | 실패·오류·생략 |
| --- | --- | --- |
| MenuUpdateRequestTests | 36 | 0 |
| MenuUpdateServiceTests | 10 | 0 |
| MenuUpdateHttpTests | 21 | 0 |
| MenuUpdateAuthorizationTests | 5 | 0 |
| MenuUpdateDatabaseTests | 12 | 0 |
| 기존 MenuDatabaseTests | 35 | 0 |
| 기존 MenuServiceApplicationTests | 46 | 0 |
| 기존 MenuExistenceServiceTests | 9 | 0 |
| 기존 PurchaseValidationServiceTests | 23 | 0 |
| **전체** | **197** | **0** |

XML 합산 결과이며 **PostgreSQL 검사는 47건**입니다. 신규 DB 검사는 필드별 부분 수정·null 제거·경계값,
옵션 수정/추가/비활성화·ID/createdAt/status·미전달 데이터·updatedAt 보존 정책, 잘못된 참조, 실제 전체 롤백과 동시성까지 포함합니다.
롤백 테스트는 테스트 전용 Repository spy에서 메뉴와 기존 옵션을 실제 flush한 뒤 새 옵션에 음수 가격을 주입해 CHECK 오류를 발생시킵니다.
이후 Service 트랜잭션 밖에서 기존 값·시각·옵션 수가 복원됐음을 확인합니다. 정상 변경은 실제 EntityManager·Spring Data Repository를 사용합니다.
Gradle 10개 task 실제 실행, BUILD SUCCESSFUL이며 기존 MI-01·MI-02 회귀와 실제 기본 403 검사가 포함됩니다.
Flyway V1 성공 및 전체 검증 종료 후 업무 테이블 각 0행을 별도 SQL로 확인한 뒤 전용 서버를 정상 종료했습니다.

작업 시작 기준 bin 117개·기존 백업 4개, 총 121개 파일의 해시 변화는 0건입니다.
#108 `237b2eb`, #110 `7ce078d`, #118 `c94ae37`와 #108 이력의 WIP `242765d`를 보존했습니다.
이전 Order bin 5개 변경·11개 추가를 정리·복구하지 않았고 bin·백업을 스테이징하지 않습니다.
실행 로그·DB 확인·해시 기준·XML 사본은 TEMP의 `peak120-760be477f8e04466b8d1d2087ecc811c`에 남겼습니다.
신규 의존성·Flyway·스키마·다른 서비스 변경은 없으며 원격 CI 성공·실제 인증·선행 PR 통합 성공은 이 로컬 결과에 포함되지 않습니다.

### 최신 main 통합 후 Draft PR 제출 전 재검증 (2026-11-19)

fetch 후 `origin/main`은 `c5135918f9d55ae4ea33739d9aa49f2803f5c6bc`였습니다.
추가 변경은 Cooking 자동 진행 관련 17개 파일이며 Menu 구현과 겹치지 않았습니다.
merge-tree 검사 및 `git merge --no-edit origin/main` 모두 충돌 없이 성공했고 통합 커밋은 `1acffc6c1acfc5b41f3baedaa1cdb84aaf0aa14b`입니다.
ME-06 제품 코드·테스트·제안 계약은 `815cb26` 대비 동일합니다. #105·#117·#119는 조회 시 미병합이며 해당 코드를 가져오지 않았습니다.

새 PostgreSQL 16.16 전용 클러스터(`127.0.0.1:52208`, `menu_120_isolated`)에서 Java 21.0.7로
`spotlessCheck test build --rerun-tasks --console=plain`을 다시 실행했습니다.
XML 합산 결과는 **197건 통과, 실패·오류·생략 0건**으로 위 클래스별 건수와 같습니다.
실제 DB 47건에 부분 수정·옵션 추가/수정/비활성화·ID/시각/판매 상태 보존, 전체 롤백 및 실제 행 잠금 동시성 검증을 포함합니다.
HTTP/OpenAPI·공통 오류·실제 기본 403과 기존 MI-01·MI-02 회귀도 통과했습니다.
Gradle 10개 task 실제 실행 후 BUILD SUCCESSFUL, Flyway V1 성공 및 종료 전 세 업무 테이블 각 0행을 확인했습니다.
전용 서버 정상 종료 후 포트 리스너 소멸을 확인했으며 공유 개발 DB는 사용하지 않았습니다.

이번 제출 단계 시작 기준 bin 117개·백업 4개 해시 변화는 0건입니다. #108/#110/#118와 WIP `242765d`는 보존했습니다.
main 대상 diff는 #120 관련 18개 파일이며 Cooking 변경·생성 파일·bin·백업을 포함하지 않습니다.
공백·변경 범위 검사 후 이 검증 기록만 추가 커밋하며 기존 제안 계약을 확정 상태로 변경하지 않습니다.
로그·해시 기준·DB 확인·XML 사본은 TEMP의 `peak120-submit-597374b5962440c28f16cb1d3be41f68`에 남겼습니다.
이번 제출은 미완료 인증·선행 통합을 명시한 Draft PR까지이며 새 리뷰 요청·Ready 전환·승인·병합은 하지 않습니다.
원격 CI 성공 여부는 이 로컬 결과와 별도로 확인해야 합니다.
