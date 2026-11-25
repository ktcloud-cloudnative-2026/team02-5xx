# Issue #297 공통 모달 backdrop 드래그 수정

## 기준과 분리

`fix/297-dialog-backdrop-drag`는 제출 시 최신 `origin/main` 316a404에서 시작했다. main에는 #258 회원가입과 down/up 보정, #132 관리자 메뉴 UI가 이미 병합돼 있다. main의 기존 보정을 유지하면서 공통 판정·최상단·중복 닫기·진행 중 정책을 확장하고 Checkout의 override를 제거했다.

기존 승인된 #297/#284 로컬 20개 파일은 저장소 밖 `C:/M/Peak_Order-git-split-297-284-20261124-150923/`의 원본·SHA-256 manifest와 경로 한정 stash에 보존했다. 다른 서비스의 미추적 bin과 다른 브랜치/worktree는 건드리지 않았다. 사용자 승인은 Commit·Push·PR 제출까지이며 병합은 수행하지 않는다.

## 원인과 수정 파일

- `src/dialogBackdrop.js`: 동일 primary pointer의 down/up이 모두 dialog 경계 밖인 경우만 닫기 후보로 삼는다. child→backdrop retarget click, 안쪽 padding, 다른 pointer·우클릭·pointer cancel과 하위 모달을 거절한다.
- `src/useDialog.js`: 공통 판정 함수를 연결하고 `canClose`·중복 close 잠금·`deferClose`를 지원한다. latest callback을 사용하고 기존 Tab·포커스·스크롤 구현은 유지한다.
- `src/components/CheckoutPage.jsx`: spread 뒤의 별도 onClick/onCancel이 공통 보정을 우회하던 원인이다. override를 없애고 deferClose로 기존 이탈 확인 정책을 유지한다.
- `tests/dialogBackdrop.test.js`: 순수 판정 Node 8개.
- `tests/dialog-drag-helpers.mjs`, `tests/dialog-drag-browser.mjs`: 실제 React 컴포넌트에서 Chromium mouse.down/move/up 검증.
- 이 문서가 일곱 번째 파일이다. package.json 변경은 없고 재고 소스·fixture·문서는 포함하지 않는다. 기존 혼합 테스트의 재고 시나리오는 #284의 별도 `tests/admin-inventory-drag-browser.mjs`로 보존한다.

## 모달별 실제 포인터 결과

| 모달                | 구현                                | 현재 결과와 정책                                                                                                                                                                                    |
| ------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 메뉴 상세           | useDialog                           | PASS. 내부 드래그 유지, 외부 단순 클릭과 포커스·스크롤 복귀                                                                                                                                         |
| 장바구니            | CartOverlay → useDialog             | PASS. 바깥 down/up·Escape 허용                                                                                                                                                                      |
| 로그인·중첩 로그인  | useDialog                           | PASS. 최상단만 닫고 하위 상세·포커스·스크롤 잠금 유지. pending 로그인은 기존 abort·늦은 응답 무효화 정책 유지                                                                                       |
| 회원가입            | LoginModal 내 화면 전환 → useDialog | PASS. 현재 main 소스로 1440/390/320 직접 실행; 이전 메모리 overlay가 필요하지 않음                                                                                                                  |
| 예상시간            | useDialog                           | PASS. 기존 기획대로 미생성 Checkout을 취소하고 메뉴 선택 복원, 주문 생성 요청 없음                                                                                                                  |
| Checkout·이탈 확인  | useDialog + deferClose              | PASS. ready/paying에서 닫기 요청은 확인 section만 표시. 명시적 이탈·계속 확인과 중복 결제 잠금 유지                                                                                                 |
| 주문 상세·취소 확인 | useDialog, 중첩                     | PASS. 확인창만 닫고 상세 유지. pending 취소·늦은 응답은 기존 store 정책 유지                                                                                                                        |
| 관리자 메뉴 #132    | 별도 AdminDialog/adminDialogFocus   | PASS. 제출 기준 main에 병합돼 기존 Mock preview를 실행했다. backdrop 닫기 금지, 드래그 유지, Escape·포커스 복귀. 관리자 구현 소스는 변경하지 않음                                                   |
| 관리자 주문 #279    | 공통 useDialog, 별도 override 없음  | BLOCKED. 미병합 코드 정적 조사만 완료. 기존 5273 서버의 HTML은 200이나 현재 checkout에 없는 admin-orders-entry.jsx를 요청해 React 화면이 비어 있음. 원본 브랜치·프로세스 수정/소스 복사는 하지 않음 |

사용자 화면 검수 당시에는 #132도 미병합·미리보기 부재로 BLOCKED였다. 이 기록을 성공으로 소급하지 않는다. 제출 전 main에 병합되어 이번 재검증에서 PASS로 해소했다. #279 BLOCKED는 남아 있다.

MenuDetail·Checkout은 제품 CSS에서 viewport 전체를 차지해 실제 바깥 좌표가 없다. 원래 화면 크기에서 내부 드래그·Escape·진행 정책을 확인하고, 해당 두 컴포넌트의 backdrop 핸들러만 **테스트 전용 40px 여백**으로 mouse down/move/up을 추가 검증했다. 제품 CSS는 변경하지 않았다.

## 제출 전 검증

- 전체 Node: **355 PASS** (현재 main + 공통 backdrop 8개).
- 공통 Chromium: **13 PASS**, #279 **1 BLOCKED**, FAIL 없음. 실제 포인터 양방향 드래그, 내부 클릭/드래그, 바깥 down/up, 중첩, Escape, 진행 중 결제, 1440/390/320, 포커스·스크롤을 포함한다.
- 기존 고객 Chromium: Auth 9 + HTTP/Checkout 23 + 장바구니 16 + 주문 내역 16 + 홈 15 = **79 PASS**.
- 추가 회원가입 회귀: 기존 `tests/registration-browser.mjs` **13 PASS**.
- Build, 변경 파일 Prettier 및 전체 Prettier `--end-of-line auto`, staged diff 검사 통과.

`PLAYWRIGHT_PACKAGE`에 설치된 Playwright 모듈 경로를 지정하고 `DIALOG_QA_OUTPUT`에 결과 디렉터리를 지정한다.

```powershell
node tests/dialog-drag-browser.mjs
node tests/registration-browser.mjs
npm test
npm run build
```

미병합 주문 preview를 읽기 전용으로 점검하려면 `ADMIN_ORDERS_AUDIT_URL`을 지정한다. 로컬 제출 검증 로그는 `C:/M/Peak_Order-git-297-qa/`에 보존한다. 실제 서비스/Auth/Gateway E2E는 이 fixture 검증 범위가 아니다.

## #284 의존성 및 병합 순서

#284는 이 브랜치의 canClose 정책과 공통 드래그 테스트 helper를 사용하므로 이 PR을 base로 stacked PR을 제출한다. **#297을 main에 병합한 후 #284 base를 main으로 바꾸고 공통 7개 파일의 중복 diff가 사라지는지 확인**한다. 사용자 승인 없이 병합·base 전환을 미리 실행하지 않는다. 재고 전용 기능·수량/연결 계약 변경은 이 PR에 포함하지 않는다.
