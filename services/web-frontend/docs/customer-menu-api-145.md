# 고객 메뉴 API 연동 (#145)

기준 브랜치는 미병합 PR #116의 `50f05425`입니다. #116·#132·#85 브랜치는 변경하지 않습니다.
API 계약은 main의 [`docs/api/menu-me01-me02.md`](https://github.com/ktcloud-cloudnative-2026/team02-5xx/blob/e9df522795a401f075365c69f59ecde56be8edc9/docs/api/menu-me01-me02.md)를
조회해 따릅니다. 현재 작업 브랜치에는 해당 백엔드 구현·문서가 없으며 임의 병합하지 않았습니다.

## 연결과 화면

- 제품 App은 Mock 저장소 대신 `GET /api/v1/menus`, `GET /api/v1/menus/{menuId}`를 호출합니다.
- 전체 카테고리는 `categoryId`를 생략합니다. `query`는 앞뒤 공백만 제거해 인코딩하고
  정렬은 `default` / `priceAsc` / `priceDesc`를 보냅니다. 목록·카테고리·정렬 결과는 서버 응답을 사용합니다.
- PAUSED도 상세를 읽을 수 있지만 담기·주문은 비활성입니다. HIDDEN은 공개 API에서 제외·404 처리합니다.
- 상세를 여는 즉시 기존 dialog를 표시하고 비동기로 로드합니다. 로딩·오류·재시도 중에도
  닫기, Escape, 포커스·스크롤 복원과 기존 중첩 로그인 안내를 유지합니다.
- 요청 교체·화면 종료 시 AbortController와 effect 정리 시의 유효성 검사로 이전 응답 적용을 막습니다.
- description/imageUrl null은 미등록 안내·기존 이미지 자리표시자로 처리합니다.
  영양·재료 정보는 API에 없어 미제공 안내를 표시하며 Mock 값을 채우지 않습니다.
- 옵션은 기존 단일 radio 선택 정책을 유지합니다. 활성 기본 옵션 또는 첫 활성 옵션을 선택하며,
  비활성 옵션은 선택할 수 없습니다. 서버가 반환한 비활성 옵션도 표시합니다.
- ID·금액은 JavaScript 안전 정수 범위로 검사합니다. 이를 넘는 Long/금액은 반올림해 사용하지 않고
  응답 오류로 처리합니다. 더 큰 ID 지원은 서버의 문자열 ID 계약 등 별도 합의가 필요합니다.

## 장바구니 보존

키 `peak-order.cart.v1`, `{version:1, items:[{menuId, optionIds, quantity}]}` 형식을 유지합니다.
최초 읽기는 항목 구조만 검사하고 원본 저장소를 쓰지 않습니다. 모든 필요한 상세 응답이
준비된 후 기존 cart 검증·중복 병합·99개 제한·가격 계산을 재사용합니다.

- 상세를 기다리거나 일부 요청이 실패하면 항목·합계를 부분 표시하지 않고 확인 중/재시도 안내를 냅니다.
- 오류 시 저장된 항목을 삭제하거나 0원으로 표시하지 않습니다. 재시도 성공 후 최신 금액을 계산합니다.
- 계약의 `404 + MENU_NOT_FOUND`만 미존재로 취급합니다. Proxy의 404·잘못된 JSON·5xx는 확인 실패입니다.
- 전체 검증 후 미존재·PAUSED·비활성 옵션 등은 복원 가능한 항목에서 제외하고 경고합니다.
  그 자체로 localStorage를 덮어쓰지 않으며 사용자가 유효한 항목을 변경할 때만 저장합니다.
- 검증 전 담기·수량 변경·삭제를 막습니다. 장바구니를 열 때도 상세를 다시 확인합니다.
- 이름·가격·인증 정보를 저장하거나 저장된 위조 가격을 신뢰하지 않습니다.
  실제 주문 생성과 가격·재고 최종 검증은 구현하지 않습니다.

## 실행

Node 24 / npm 11, 기존 의존성과 lockfile을 사용합니다.

```powershell
cd services/web-frontend
# 실제 Menu Service가 실행 중인 주소로 지정합니다. 자격 증명은 넣지 않습니다.
$env:MENU_API_TARGET = 'http://127.0.0.1:8080'
npm.cmd run dev -- --host 127.0.0.1
```

Vite 개발 Proxy만 `/api/v1/menus` 요청을 전달합니다. 기본 대상은 `http://127.0.0.1:8080`입니다.
제품 빌드는 같은 origin의 `/api/v1/menus`를 호출하므로 실제 배포에는 Gateway/역방향 Proxy 경로가
필요합니다. 기존 Nginx·Gateway 배포 설정은 이 작업에서 변경하지 않았습니다.

실서버가 없을 때 화면 확인은 다음 **계약 Mock HTTP 전용 미리보기**로 가능합니다.
기존 프로젝트의 일반 고객 App을 실행하며 별도 프로젝트·의존성을 만들지 않습니다.

```powershell
node tests/menu-api-preview.mjs
```

이 주소는 실제 Menu Service·DB·Gateway 성공을 뜻하지 않습니다. 샘플은 기존 UI fixture의
메뉴·카테고리에서 계약 필드만 추출하고 description/imageUrl은 null로 반환합니다.
테스트 세션 주입 UI는 이 고객 미리보기에 포함되지 않습니다. 제품은 비회원이며
실제 Auth/JWT·주문·결제·관리자 API를 연결하지 않습니다.

## 검증 기록

2026-11-19 Windows, Node 24.22.3 / npm 11.19.1에서 검증했습니다.

- `npm test`: 기존 62건과 신규 HTTP·장바구니 검증 14건, 총 76건 통과
- 기존 SSR 테스트 1건은 즉시 Mock 메뉴 대신 초기 로딩 상태를 기대하도록 변경했습니다.
- `npm run build`: 통과
- `npm run format:check -- --end-of-line auto`: 전체 통과. 옵션 없는 검사는 수정하지 않은
  기존 파일의 CRLF 줄바꿈 때문에 실패했습니다. 최초 경고 20개는 메모리에서 CRLF만 LF로
  정규화하면 모두 통과했습니다. 이후 관련 README를 갱신·포맷해 최종 경고는
  수정하지 않은 파일 19개이며, 범위 밖 파일은 변경하지 않았습니다.
- 변경 파일의 기본 Prettier 검사와 `git diff --check`: 통과
- 메모리 제품 빌드의 모듈 목록에서 Mock 카탈로그와 tests fixture 제외 확인
- 실제 Chromium에서 새 연동에 한정한 6개 시나리오 통과, pageerror 0건
  (목록/필터/검색/정렬·오래된 응답, PAUSED 상세·옵션, 비회원 중첩 모달,
  저장소 보존·실패/재시도·가격/수량/삭제·오버레이 history, 목록 오류/재시도, 320px 흐름)
- 위 HTTP·Chromium 검증은 계약 Mock 서버를 사용했습니다. 기존 Chromium QA 전체를 반복하지 않았습니다.
- 실제 Menu Service의 기본 로컬 포트 8080은 리스닝하지 않아 실연동은 미검증입니다.
  실제 서비스 주소와 접근 경로가 준비되면 목록·상세·오류 응답을 추가 확인해야 합니다.

집중 Chromium 검증은 기존 외부 Playwright 설치를 지정해 실행할 수 있습니다.
새 Playwright 의존성을 프로젝트에 추가하지 않습니다.

```powershell
$env:PLAYWRIGHT_PACKAGE = '<기존 Playwright 패키지 디렉터리>'
$env:PLAYWRIGHT_BROWSERS_PATH = '<기존 Chromium 설치 디렉터리>'
$env:MENU_QA_OUTPUT = '<스크린샷·결과 저장 디렉터리>'
node tests/menu-api-browser.mjs
```

사용자 화면 확인과 승인 전 Commit·Push·PR 생성은 하지 않습니다.
