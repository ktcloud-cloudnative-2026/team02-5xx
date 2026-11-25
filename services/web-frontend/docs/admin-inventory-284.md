# Issue #284 관리자 재고 관리

## 범위와 기준

- 브랜치 `feat/284-admin-inventory-ui`, 원래 승인본 기준은 **8434a67**. 제출 시 최신 main **316a404**에서 만든 #297 공통 수정 **fb39138**을 base로 쌓았다. 기존 브랜치를 fast-forward했으며 reset/rebase/force push는 사용하지 않았다.
- `Depends on #297` — 구현 PR은 **#298**, PR base는 `fix/297-dialog-backdrop-drag`다. 공통 변경 7개 파일은 이 재고 PR의 diff에서 제외한다.
- 고객 App의 인증·라우팅·CSS와 다른 관리자 PR의 코드를 변경하거나 가져오지 않았다.
- 독립 React 화면 `src/admin-inventory/AdminInventoryPage.jsx`, HTTP 클라이언트 `inventoryAdminApi.js`, 요청 수명 관리 `inventoryAdminStore.js`, 메뉴 조회·선택 `InventoryMenus.jsx`, 전용 스타일 `adminInventory.css`.
- 사용자 검수 후 공통 모달 수정은 #297로 분리해 먼저 제출했다. 제품 전역 수정 파일과 별도 PR 분리 범위는 [모달 드래그 점검 문서](dialog-drag-audit.md)에 구분했다. 다른 미병합 PR은 수정·통합하지 않았다.
- `tests/admin-inventory-*`는 독립 HTTP fixture, 브라우저 진입점·시나리오·미리보기·Chromium 테스트다. `tests/admin-inventory.test.js`는 Node 계약·상태·실제 loopback HTTP 테스트다. `package.json`에 미리보기 명령만 추가했다.
- Inventory 백엔드·DB·Gateway·Kubernetes는 변경하지 않았다. 기존 미추적 서비스 `bin/`도 보존했다. 사용자 화면 검수 PASS 및 Commit·Push·PR 승인 후 제출하며, PR 병합은 수행하지 않는다.

## 직접 확인한 디자인

`design-reference/menu-ui/`의 다음 원본을 직접 열어 확인했다.

| 원본 파일                                            | 반영 내용                                                                                       |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `WF_관리자 · 재고관리 1.png`, `.svg`                 | 흰색 사이드바, 회색 배경, 검은 활성 메뉴·버튼, 둥근 목록 카드, 연한 테이블 헤더, 상태·연결 배지 |
| `WF_관리자 · 재고 등록 (오른쪽 창) 1.png`, `.svg`    | 오른쪽 작업 패널, 헤더·입력 영역·고정 하단 버튼, 배경 흐림                                      |
| `WF_관리자 · 재고 수정 (오른쪽 창) 1.png`            | 현재 수량 정보와 입고 입력 구분, 빠른 수량 입력                                                 |
| `WF_관리자 · 메뉴 연결 (모달) 1.png`                 | 연결 상태와 작업 버튼의 표현; 실제 계약에 맞춰 단일 메뉴 ID 연결·해제를 패널에 배치             |
| `WF_관리자 · 삭제 확인 (모달 · 재고메뉴 공통) 1.png` | 중앙 확인 모달, 취소 우선 포커스, 삭제 전 설명                                                  |
| `WF_관리자 · 메뉴관리 1.svg`                         | 사이드바·테이블·관리 버튼의 시각적 통일                                                         |
| `WF_관리자 · 주문 조리 현황 1.svg`                   | 관리자 화면의 카드·타이포그래피·흑백 톤                                                         |

PR #132 목록 화면의 기존 로컬 캡처 `C:/M/Peak_Order-local-audits/ui-reference-audit-20261123/admin132-list.png`와 PR #279 화면 캡처 `C:/M/Peak_Order-admin-orders-273-qa/desktop-manual-review.png`도 시각적으로 대조했다. 미병합 PR의 소스는 통합하지 않았다. 원본 SVG는 Chromium으로 렌더링한 후 PNG로 확인했다.

별도의 재고 이름·복수 메뉴·임시 확보 타이머·재고 목록 검색·정렬·페이지 이동·재고 감소·임의 수량 수정은 Inventory API가 지원하지 않아 추가하지 않았다. 대표 명칭은 Menu API에서 조회한 연결 메뉴 이름, 보조 식별자는 실제 재고 ID와 메뉴 ID다. 390px·320px에서는 동일 데이터를 두 열 카드로 재배치하고 작업 패널은 전체 너비로 표시한다.

## 검수 후 등록 UX와 메뉴 이름

- 변경 전: 재고 ID를 대표로 표시하고 수량·부족 기준만 등록, 이후 별도 메뉴 ID 입력으로 연결했다.
- 변경 후: 연결된 메뉴 이름을 대표로 표시한다. 등록 패널에서 메뉴 이름 검색·선택 또는 미연결 등록을 선택한다. 입고 패널에도 메뉴 이름, 현재 실제·예약·가용 수량과 추가 수량을 구분한다.
- 기존 `src/data/menuApi.js`의 실제 ME-01·02 검증 계층을 재사용한다. ME-01 `GET /api/v1/menus?sort=default`의 전체 공개 메뉴 목록(ON_SALE·PAUSED)으로 이름을 조합하고 등록 검색은 이 목록에서 필터링한다. 목록에서 해결되지 않거나 목록이 실패한 연결 ID는 ME-02 `GET /api/v1/menus/{id}`로 확인한다.
- 조회 실패·HIDDEN/미존재는 이름을 만들지 않고 `메뉴 ID n`과 `메뉴 이름 조회 불가`로 표시한다. 미연결은 상태 설명 `미연결 재고`와 재고 ID를 표시한다. 이름 조회 장애로 재고 수량을 없애거나 등록을 막지 않는다. 재시도 시 이전 이름 응답은 AbortController·조회 버전으로 차단한다.
- 메뉴 선택 등록은 **IN-03 성공 확인 → IN-05 연결**의 두 단계다. IN-03 본문은 여전히 `{stockQty, lowStockThreshold}`뿐이며 `stockName`·`menuId`를 추가하지 않는다.
- IN-05 실패 시 IN-03의 생성 성공을 별도로 알리고 재고·수량을 유지한다. 같은 재고의 연결 재시도 패널로 전환하며 생성 POST를 다시 보내거나 보상 DELETE를 호출하지 않는다. 연결 결과가 불명확하면 전체 목록을 먼저 확인한다. IN-03 자체의 결과가 불명확하면 IN-05를 자동 호출하지 않는다.

## 실제 HTTP 계약

구현 기준은 `services/inventory-service/README.md`, `InventoryAdminController`, `InventoryAdminService`, `StockItemResponse`, `StockItemCreateRequest`, `StockRestockRequest`, `MenuLinkRequest`, Inventory ERD다.

| 기능            | 요청                                                                          | 성공                                |
| --------------- | ----------------------------------------------------------------------------- | ----------------------------------- |
| IN-02 목록      | `GET /api/v1/admin/inventory/items?lowStockOnly=false` 또는 `true`            | 200, DTO 배열, ID 오름차순          |
| IN-03 등록      | `POST /api/v1/admin/inventory/items` `{stockQty, lowStockThreshold}`          | 201, 미연결 DTO                     |
| IN-04 입고      | `POST /api/v1/admin/inventory/items/{id}/adjustments` `{quantity}`            | 200, 변경 DTO                       |
| IN-05 연결·해제 | `PUT /api/v1/admin/inventory/items/{id}/menu-link` `{menuId: 정수 또는 null}` | 200, 변경 DTO                       |
| IN-06 논리 삭제 | `DELETE /api/v1/admin/inventory/items/{id}` 본문 없음                         | **200, 연결 해제된 DTO** (204 아님) |

공통 envelope의 `success`와 `data`를 검증한다. DTO의 `stockItemId`, 명시적인 nullable `menuId`, `stockQty`, `reservedQty`, `availableQty`, `lowStockThreshold`, `lowStock`을 검증하며 가용 수량 산식·중복 ID·잘못된 정렬도 확인한다. `lowStock`은 서버 값을 그대로 사용하고 가용 수량 0의 품절 배지와 별도로 표시한다. 없는 필드를 가상으로 보충하지 않는다.

수량은 Java int 범위의 0 이상 정수, 입고는 1 이상 정수다. 소수·음수·지수 표기와 범위 초과를 거절한다. Java Long ID를 손실 없이 처리할 수 있도록 JavaScript 안전한 양의 정수만 허용하고, 범위를 넘은 응답은 오류로 처리한다.

400, 401, 403, 404와 `STOCK_ITEM_IN_USE`, `MENU_ALREADY_LINKED`, `MENU_NOT_LINKABLE`, `MENU_SERVICE_UNAVAILABLE`, `MENU_NOT_FOUND`, `INVENTORY_NOT_FOUND`를 구분한다. 예약 0만으로 연결·삭제 가능 여부를 추정하지 않는다. RESERVED뿐 아니라 CONFIRMED 주문도 서버가 변경을 거절할 수 있다.

## 요청 안전성과 인증 경계

- Fetch는 동일 출처 경로와 `credentials: same-origin`을 사용한다. 관리자 신원·토큰 헤더를 생성하지 않으며 리다이렉트도 성공 응답으로 취급하지 않는다.
- 조회는 AbortController와 세대 번호로 이전 필터·화면의 응답을 차단한다. 중복 변경 요청을 동기적으로 잠그고 성공한 서버 DTO를 적용한 뒤 최신 목록만 GET으로 재조회한다.
- 저장 중에는 취소·닫기·바깥 클릭·Escape를 차단한다. store도 중복 닫기·제출을 동기적으로 차단한다. 화면 폐기·재활성화 또는 더 최신의 401/403 뒤 이전 응답은 적용하지 않는다. 이미 전송한 서버 변경을 화면 폐기로 취소했다고 주장하지 않는다.
- 서버 실패 시 기존 재고와 사용자 입력을 보존한다. 401/403은 이전 목록을 감춘다. 성공 후 후속 GET이 실패해도 이미 확인된 변경을 실패로 바꾸지 않는다.
- 응답 유실·잘못된 성공 응답·불명확한 서버 실패는 반영 여부 불명으로 안내한다. 자동 변경 재전송은 없다. **전체 목록 GET 확인 후 사용자가 명시적으로 다시 제출**할 수 있다. 등록·입고는 멱등 API가 아니므로 이미 반영되었다면 패널을 닫도록 안내한다.
- Escape·Tab 포커스 격리·닫기 후 호출 버튼 복귀는 main의 공통 `useDialog`를 재사용한다.
- 고객 제품 빌드에 관리자 컴포넌트·API 경로·fixture 도구가 포함되지 않는 경계 테스트를 수행한다.

## 실행과 검수 순서

`services/web-frontend/`에서 `npm run test:admin-inventory:ui`로 실행한다. 기본 URL은 **http://127.0.0.1:5284/** 이며 `INVENTORY_PREVIEW_PORT`로 포트를 바꿀 수 있다. Node가 Vite로 독립 React 번들을 생성하고 실제 loopback HTTP 서버에서 화면과 JSON 계약을 제공한다. 시작 이후 소스를 바꾸었다면 미리보기 프로세스를 재시작한다.

1. 기본 목록: #101 정상, #102 부족, #103 예약으로 인한 품절, #105 정상 미연결, #106 재고 0 미연결을 확인한다. 부족 필터는 #102·103·106을 반환한다.
2. 등록: 실제 수량과 부족 기준을 입력하고 공개 메뉴 이름을 검색·선택한다. 메뉴 ID 5를 선택하면 생성 후 연결까지 완료된다. 미연결 선택도 가능하다. 이미 사용 중인 메뉴 ID 1을 선택하면 생성은 완료되고 연결만 실패하며, 같은 재고를 다른 메뉴에 다시 연결할 수 있다.
3. 입고: #102에 10개를 추가하고 부족 필터에서 사라지는지 확인한다. 입력 수량을 자동으로 변경하지 않는다.
4. 연결: #105에 메뉴 ID 77 연결 후 해제한다. 메뉴 ID 1은 다른 재고와 중복, 999는 HIDDEN, 998은 메뉴 서버 장애, 997은 없는 메뉴 샘플이다.
5. 삭제: #105는 삭제할 수 있다. #104는 예약 수량 0이어도 활성 주문 때문에 연결 변경·삭제가 거절된다.
6. 페이지 하단 **검수 시나리오 → 시나리오 적용·초기화**에서 메뉴 이름·목록 조회 실패, 비공개 메뉴 이름, 빈 목록, 목록·변경 401/403/404/400, 409, 503, 1.5초 지연, 변경 반영 후 응답 유실을 확인한다. 적용하면 샘플을 초기화한다. 정상 시나리오로 복귀하면 다시 사용할 수 있다.
7. 390px·320px 너비에서 목록 카드, 입고 패널, 삭제 확인, 키보드·Escape를 확인한다.

fixture 데이터는 프로세스 메모리에만 존재한다. 실제 사용자·메뉴·재고 DB에 쓰지 않는다. 관리자 메뉴는 독립 화면 표시이며 고객 앱의 관리자 라우팅·메뉴 이동을 추가하지 않는다.

## 검증 결과

- 제출 기준 전체 Node **412개 통과** (#297 기준 355 + 재고 57). 기존 승인본 Node 316 결과도 외부 백업에 유지했다. 계약·숫자 경계·DTO·오류·실제 HTTP CRUD·두 단계 등록·부분 성공·무단 신원 헤더 없음·늦은 조회/변경·중복 제출·결과 불명·제품 번들 격리를 포함한다.
- 관리자 재고 Chromium **27개 통과**, 1440px·390px·320px. CRUD, 필터, 이름 조회·검색 선택·부분 성공 복구·메뉴 이름 지연 응답, 오류, 실패 입력 보존, 네트워크 재시도, 응답 유실 후 중복 변경 없음, 저장 중 닫기 차단, 키보드·포커스와 overflow를 확인했다.
- 기존 고객 Chromium **79개 통과**: Auth 9, 고객 HTTP/Checkout 23, 비회원 장바구니 16, 주문 내역 16, 홈 15.
- 추가 회원가입 Chromium **13개 통과**. 공통 모달 회귀는 #297의 13 PASS 결과를 유지한다.
- 기존 혼합 드래그 테스트에서 재고 부분을 `tests/admin-inventory-drag-browser.mjs`로 분리해 **10 PASS** (등록/입고/연결/삭제의 일반·저장 중 드래그 각 8 + 모바일 390/320 각 1)를 확인했다. 모든 pointer는 실제 mouse down/move/up이며 공통 #297 helper를 재사용한다.
- #132는 제출 기준 main에 병합되어 #297의 실제 미리보기 테스트에서 PASS. #279는 미병합이며 기존 미리보기 진입 파일 부재로 BLOCKED다. 해당 브랜치 소스 수정·복사는 하지 않았다.
- Build, 변경 파일 Prettier, 전체 Prettier(기존 CRLF를 인정하는 `--end-of-line auto`), `git diff --check` 통과. 신규 파일도 `git diff --no-index --check`로 확인했다.
- 화면 캡처·결과 JSON·로그: `C:/M/Peak_Order-admin-inventory-284-qa/` (저장소 밖).
- 분리 제출 재검증 로그: `C:/M/Peak_Order-git-284-qa/`. 기존 승인본은 `C:/M/Peak_Order-git-split-297-284-20261124-150923/` 및 이름 붙인 경로 한정 stash에 보존했다.

## Stacked PR과 main 전환 준비

이 PR은 **#298 (#297) → 재고 #284 PR** 순서로 병합해야 한다. 지금은 #298 브랜치를 base로 사용하며 병합하지 않는다. #298이 squash merge되면 단순 base 변경만으로는 공통 조상이 달라 공통 diff가 다시 나타날 수 있다. 그때 최신 origin/main을 재고 브랜치에 일반 merge하여 ancestry를 잇고, 강제 push 없이 push한 뒤 base를 main으로 전환한다.

```powershell
# #298의 실제 병합을 확인한 후에만 수행할 후속 절차. 현재 미실행.
git fetch origin
git switch feat/284-admin-inventory-ui
git merge --no-edit origin/main
git push origin feat/284-admin-inventory-ui
# 재고 PR base를 main으로 전환
git diff --name-only origin/main...HEAD
```

마지막 diff에는 `src/admin-inventory/` 5개, `tests/admin-inventory*` 7개, 이 문서와 package.json의 미리보기 명령 1줄만 남아야 한다. `useDialog.js`, `dialogBackdrop.js`, `CheckoutPage.jsx`, 공통 테스트·감사 문서가 중복으로 나오면 해결·재검증 전 병합하지 않는다. 현재 base 대비 이러한 중복은 없다. 고객 인증/라우팅과 main의 관리자 메뉴·회원가입 명령은 보존한다.

## 실제 서버 E2E 미검증

HTTP fixture 성공은 실제 관리자 인증 성공이 아니다. 기본 `INVENTORY_ADMIN_ENABLED=false`를 유지했다. 실제 Inventory/Menu 의존 호출, Auth/Gateway의 관리자 인증·인가 및 라우팅, 실제 DB의 예약·확정 주문/논리 삭제 정합성, 동시 요청·운영 장애 E2E는 검증하지 않았다. 승인된 실제 관리자 진입점과 인증 구성이 준비되면 동일 컴포넌트·HTTP 계층으로 확인해야 한다.
