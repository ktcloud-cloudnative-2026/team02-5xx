# 고객 주문 확인·결제 Mock UI — #192

## 기준과 선행 작업

- 작업 기준 main: `ca43852c7f2a87eeebfa7b09896ec4f0a8f84e25` (2026-11-23 fetch).
- 브랜치 `feat/192-web-checkout-ui`, 별도 worktree `C:\M\Peak_Order-192-checkout`.
- PR #148(`a271576ff263200b155e2f9824d7b1d71632bda2`), #188(`c5f5af5e84d3be97dc7dd022683f9349e1280fdf`), #132(`f16b494da4a18770b8bf35b2a88152fc205e5b5e`)는 조사 당시 미병합. 가져오거나 원본을 수정하지 않았다.
- 기존 통합 worktree의 21개 Staging·진행 중 Merge 및 `integration-handoff.txt`, `boundary-20261123/handoff-update.txt`를 확인했다. 과거 QA 112 Node·27 Chromium 결과는 이 브랜치의 검증 수에 포함하지 않는다.

## 확인한 기획과 계약

저장소 `docs/plan.md`, `docs/requirements.md`는 템플릿이므로 확정 기획으로 사용하지 않았다.
Notion의 다음 원본을 읽었다. 페이지 자체는 Notion verification `unverified`이며, 최신 확정 결정 표와 현재 코드가 일치하는 범위를 적용했다. 과거 아이디어·미결정 항목을 확정 사항으로 확대하지 않았다.

- [Project Canvas](https://www.notion.so/2fb2f07e94788325a23781f07768b193): 로그인 고객의 메뉴→장바구니→모의 결제→주문번호, 실제 결제·배달 제외.
- [요구사항](https://www.notion.so/40f2f07e9478807e9247f4aa28eb3348): US-02~07·10·13·15~16. 임시 주문, 재고 확보 만료, 결제 확정 후 번호, 실패 후 새 임시 주문, 고객 권한.
- [설계 결정 기록](https://www.notion.so/40f2f07e947880e79b0bd511e54367a5): 최신 확정 결정 보완 표. 프런트 장바구니, 부분 확보 없음, FIFO·이벤트·고객/매장 관리자 구분.

| 경계          | 확인 근거                                                                      | UI/adapter 적용                                                                                                                                  |
| ------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Menu ME-01·02 | main 메뉴 Repository, PR #148 및 Menu 조회 구현                                | 기존 main Mock 카탈로그와 `describeItem/cartView` 재사용. 저장 가격·이름 무시, ON_SALE·활성 옵션·수량 검증                                       |
| MI-01         | Menu 구매 검증 구현·명세                                                       | Order/Cooking의 내부 API. 프런트가 직접 호출하거나 재고 판정을 대신하지 않음                                                                     |
| CO-02         | `docs/api/cooking-co02.md`, Cooking DTO·서비스                                 | `{items:[{menuId,quantity,optionIds}]}`. `expectedWaitSec` 시작까지, `cookSec` 선택 조리시간, `expectedReadySec` 완료까지(앞 둘의 합), 단위 초   |
| OR-01         | `OrderController`, `CreateOrderRequest`, `OrderService`, `OrderDetailResponse` | 항목 1~20개·수량 1~99. Menu 검증·Inventory 임시 확보 후 CREATED/orderId/holdExpiresAt. 주문번호 없음. 응답 항목·합계 검증 후 재계산 금액 표시    |
| OR-02         | `OrderService.payOrder`·ErrorCode·Order README                                 | 본문 없는 pay. 확정된 상태 재호출은 기존 결과, 처리 중 ORDER_PAY_IN_PROGRESS. Payment→재고 확정→PAID/orderNo·outbox. 실패 확정은 종료 후 새 주문 |
| OR-03·04      | Order 조회 DTO·서비스                                                          | 실제 목록은 CREATED/FAILED 제외. 결과 불명은 알려진 orderId로 상세 조회만. CREATED 조회만으로 실패 단정 금지                                     |
| Inventory     | 임시 확보·확정·해제 구현과 Order 처리                                          | 부분 확보 없음. 프런트는 직접 확보·차감·해제하지 않음                                                                                            |
| Payment       | Payment Mock 구현과 Order PI-01 호출                                           | 실제 PG 아님. 서버 멱등키 `order-{orderId}`는 Order 책임. 프런트가 생성하지 않음                                                                 |
| Cooking 등록  | Order outbox·OrderConfirmed, Cooking consumer                                  | 결제 확정과 조리 전표 등록은 비동기. PAID만 보고 조리 등록 완료로 표시하지 않음                                                                  |
| Auth          | main 주입형 세션 경계·Auth 구현·#188                                           | checkout은 authenticated + user.id + user.role=CUSTOMER 필요. 인증 구현 복제 없음. X-User-Id 생성 없음                                           |

일반 JSON envelope의 `data`를 adapter가 반환하는 인터페이스다. HTTP 교체 시 success/errorCode·상태 코드·빈 본문·네트워크 불명 결과를 정확히 해석해야 한다. `definitive`는 adapter 내부 분류이며 서버 응답 필드를 신설한 것이 아니다. HTTP 4xx 전체를 실패 확정으로 취급하면 안 된다.

## 실행과 실제 연결 범위

```powershell
cd services/web-frontend
npm.cmd test
npm.cmd run build
npm.cmd run test:checkout:ui
```

마지막 명령은 로컬 테스트 전용 서버를 실행하고 URL을 출력한다. 기존 메뉴에서 옵션·수량 선택 후 장바구니 또는 즉시 주문을 사용한다. 기본 테스트 세션은 합성 CUSTOMER다. URL의 `scenario=declined`, `unknown`, `unknown-paid`, `create-failed`로 예외를 체험할 수 있다. `session=anonymous|admin`, `estimate=unavailable|outage|invalid|timeout|retry`도 테스트 entry에서만 해석한다.

**기본 제품 진입점은 main의 anonymousSession·로그인 안내를 유지한다. 실제 로그인 성공을 구현하거나 가짜 인증을 제품에 추가하지 않았다.** 따라서 기본 `npm run dev`에서 실제 로그인으로 checkout까지 들어가는 검증은 #188 통합 이후다. 현재 완결된 UI 흐름은 같은 App에 테스트 전용 검증 세션을 주입해 확인한다. 이는 인증 우회 기능이나 실제 서버 연동 성공이 아니다.

`src/checkout/mockCheckoutAdapter.js`는 의도한 브라우저 내 체험 코드로 제품 번들에 포함된다. Mock HTTP 서버·합성 세션 제어·Playwright·테스트 entry는 제품 번들에 포함하지 않는다. 새 라이브러리는 추가하지 않았다.

## 화면과 상태 처리

- `App`: 기존 진입 의도·주입형 인증 경계를 사용해 최소 연결. 주문 내용만 복사하고 기존 저장 형식은 유지한다. `#checkout`의 전체 화면 native dialog를 사용하며 이전 메뉴·상세·장바구니를 아래에 보존한다. 브라우저 뒤로가기 시 폐기한 flow는 늦은 응답으로 복원되지 않는다.
- `CheckoutPage`: 주문 단계, 임시 주문과 결제 분리, holdExpiresAt 기반 남은 시간, 진행·종료 안내. 성공·실패·불명 결과에 포커스 이동.
- `OrderSummary`: 현재 카탈로그로 검증한 이름·옵션·수량·금액. OR-01 모의 응답 이후에는 응답 항목과 재계산 금액.
- `PaymentMethodSelector`: 네 가지 UI 라디오 선택. 요청 DTO에 결제수단을 넣지 않는다.
- `OrderEstimateDialog`: 즉시 주문 진입의 대기·조리·완료 예상시간, 로딩·장애·판매 불가·응답 오류·재시도. 닫으면 기존 옵션·수량·장바구니가 유지된다.
- `PaymentFailureNotice`: 명확한 실패와 결과 불명을 구분. 불명은 새 주문·결제 버튼 없이 상세 조회만 제공한다.
- `checkoutFlow`: review → creating → ready → paying → paid/failed/unknown. 단일 실행 잠금, timeout·AbortSignal·generation·계정 식별자와 세션 알림으로 늦은 결과 차단. CUSTOMER→비회원/다른 계정/다른 역할 변화는 session-ended로 종료하며 재로그인으로 이전 동작을 재개하지 않는다.

장바구니와 즉시 주문은 같은 화면을 사용한다. 사용자 수동 검수 후 확정한 동작에 따라, 장바구니 주문 성공이 확인되면 해당 주문 수량만 현재 장바구니에서 제거한다. 현재 수량이 주문 수량보다 크면 차이만 남기고, 작거나 같으면 해당 항목만 제거한다. 다른 메뉴·옵션·추가 품목은 보존한다. 즉시 주문은 성공해도 기존 장바구니를 변경하지 않는다. 계정별 소유권·이관 정책은 별도 결정 대상이다. 기존 radio 옵션 1개 정책을 유지하고 Order 최대 20개 옵션 계약을 새 UI 정책으로 확대하지 않았다.

완료 버튼은 두 진입 경로 모두 **메뉴로 돌아가기**이며 장바구니·상세를 닫고 목록으로 이동한다. 현재 Checkout History entry를 메뉴 entry로 교체하고, flow가 없는 오래된 `#checkout` 진입도 메뉴로 정리한다. 성공 후 브라우저 뒤로가기/앞으로가기로 완료된 주문을 재결제하지 않는다. 성공 전 뒤로가기는 기존 선택 복귀 동작을 유지한다.

`checkoutFlow`는 유효한 성공 응답·현재 세션·generation 검증 뒤 `onPaid` 후처리를 동기적으로 정확히 한 번 실행한다. React effect/state updater에서 저장하지 않으므로 중복 렌더·결과 조회로 두 번 차감하지 않는다. 결과 불명에서 조회로 성공이 확인돼도 동일한 경로를 사용한다. 실패 확정·임시 생성 실패·결과 불명·세션 종료·dispose 뒤 늦은 성공은 장바구니를 변경하지 않는다.

`checkoutCompletion.js`는 진입 당시 주문 수량과 현재 장바구니를 대조한다. 진입 이후 저장 내용이 달라졌으면 최신 저장 값에서 차감하며, 저장 값이 그대로면 현재 메모리의 추가 변경을 보존한다. 저장 형식은 기존 `peak-order.cart.v1`을 유지한다. 손상/접근 실패/저장 실패 시 덮어쓰지 않고 성공 화면에서 장바구니 정리 경고를 제공한다. 이는 결제 실패나 재결제 사유로 바꾸지 않는다. 다중 탭 전체의 원자적 조정/계정별 소유권 정책을 구현한 것은 아니다.

결과 불명 상태는 조회만으로 PAID 등 확정 상태가 확인된 경우에만 성공으로 전환한다. 임시 생성 응답 유실로 ID가 없으면 이 Mock에서 조회할 수 없다고 알린다. 화면 내 재결제·자동 새 주문은 없다. 종료/뒤로가기는 서버 취소·환불·재고 해제를 의미하지 않는다. 명시적 닫기에는 처리 중/임시 생성 후/결과 불명 경고가 있다. 브라우저 뒤로가기·새로고침·다중 탭까지 주문 복구를 보장하는 기능은 구현하지 않았다. 현재 메모리 Mock을 HTTP adapter만 교체해 운영 배포해서는 안 된다.

## 디자인과 업무 계약 차이

다음 PNG와 대응 SVG를 모두 확인했다(각 1920×1080).

- `WF_주문 확인 · 결제 1`
- `WF_주문 확인 · 결제 (결제 실패 시) 1`
- `05_즉시 주문 → 대기·조리시간 (팝업) 1`

회색 배경·좌측 내비 영역·중앙 단계/지불 수단·우측 주문 요약·검정 주요 버튼·둥근 팝업을 반영했다. 기존 글꼴·색상·버튼·dialog 포커스/스크롤 처리를 재사용했다. 1440px에서 폭 조정, 390px에서 결제수단 2열·주문 요약 세로 배치다. 사진은 기존과 같은 자리표시자다.

| 시안                       | 적용 판단                                                                    |
| -------------------------- | ---------------------------------------------------------------------------- |
| 결제수단 4종               | 선택 UI만 제공. OR-02에 해당 필드 없음. 실제 지원으로 표시하지 않음          |
| 단일 결제 버튼             | 임시 주문 생성→응답 금액·확보 만료시간 확인→결제로 분리                      |
| 결제 실패 토스트·다시 결제 | 영구 안내 카드, 실패 확정은 새 임시 주문. 불명은 조회만 제공                 |
| 대기시간 강조              | 시작까지 대기·조리 소요·완료까지를 구분하여 표시                             |
| 결제 완료·번호             | MOCK 접두사·테스트 전용 표시, 실제 업무 처리 성공과 구분                     |
| 빈 여백                    | 확정 요구사항 사용에 필요한 예상시간·임시 확보·처리 상태·오류/종료 안내 추가 |

## 검증 기록 및 후속

2026-11-23 최종 실행: Node 24.22.3 / npm 11.19.1.

| 검사                            | 결과                                                 |
| ------------------------------- | ---------------------------------------------------- |
| 기존 main Node 회귀             | 62 PASS                                              |
| 추가 checkout·번들 경계         | 22 PASS                                              |
| 전체 `npm.cmd test`             | 84 PASS, 실패·취소·생략 0                            |
| 실제 Chromium Mock adapter QA   | 23 PASS / 0 FAIL, Console·Network 오류 0             |
| 1920×1080 / 1440×1000 / 390×844 | 실제 렌더링·조작·캡처 확인                           |
| Vite production build           | PASS                                                 |
| 변경 18개 파일 Prettier         | PASS                                                 |
| Git diff 공백 검사              | PASS (기존 CRLF 변환 경고와 구분)                    |
| 제품 번들 경계                  | 테스트 서버·세션 주입·Playwright·X-User-Id 제외 PASS |

수정 파일 4개: `README.md`, `package.json`(실행 script만), `src/App.jsx`, `tests/ui-fixture.mjs`(선택적 entry만).
신규 파일 14개: 이 문서, `src/checkout/{checkout.css,checkoutFlow.js,mockCheckoutAdapter.js}`, `src/components/{CheckoutPage,OrderEstimateDialog,OrderSummary,PaymentFailureNotice,PaymentMethodSelector}.jsx`, `tests/{checkout.test.js,checkout-bundle.test.js,checkout-browser-entry.jsx,checkout-browser.mjs,checkout-preview.mjs}`.

원본 HEAD·index SHA-256과 통합 worktree HEAD·index SHA-256은 작업 전후 동일하다. 통합 Staging 21개·MERGE_HEAD 유지, 원본 bin 338개·백업 4개는 기록된 SHA-256과 변경·누락 0건이다. 과거 106개 해시는 미검증이다. 원본 JDT/Gradle 보호 설정·exclude·감사 기준 해시는 유지했고 새 worktree에도 Git 제외 상태로 같은 보호 설정을 적용했다. 실행 중 IDE/JDT가 설정을 다시 읽었다는 런타임 확인이나 프로세스 강제 종료는 하지 않았다.

테스트를 먼저 작성한 초기 실행은 구현 모듈 부재로 실패했다. 1차 브라우저에서는 라디오 그룹 Tab 경계 결함 1건과 모호한 테스트 선택자 오류가 확인됐다. 라디오 그룹에서 선택한 항목만 Tab 정지점이 되도록 최소 수정했다. 이후 모바일 결과 제목 포커스/스크롤도 보완했다. 기존 전체 포맷 대신 변경 파일만 Prettier로 검사한다.

상세 명령 결과·실제 수·실패/통과 로그·화면 캡처는 외부 감사 `C:\M\Peak_Order-local-audits\checkout-192`에 보존한다. Chromium은 production-compiled React를 렌더링했다. SSR 검사와 구분하며 StrictMode wrapper만으로 개발 effect 이중 실행까지 검증했다고 주장하지 않는다.

실제 연동 전 필요 사항:

1. #148·#188 병합 후 최신 main 통합. 메뉴 HTTP 검증 준비/실패·재시도 및 이전 통합 리허설 경합 보완을 함께 적용. 미검증 가격 상태에서 checkout 진입 금지.
2. Auth verified snapshot 연결, 실제 Gateway 권한 전달 계약 확정. Order 임시 X-User-Id를 프런트에서 만들지 않음.
3. CO-02/OR-01/02/04 HTTP adapter, 서버 envelope·모든 오류 코드·재계산/만료/중복 처리 계약 테스트. Order가 Payment·Inventory·Cooking 호출.
4. 실제 HTTPS Refresh Cookie·Origin/CORS/CSRF·세션 만료·다중 탭 검증.
5. 생성 응답 유실·재접속/새로고침·화면 이탈 후 불명 주문 조회/복구와 계정별 장바구니 정책 확정. 무조건 재결제·환불 완료로 표시하지 않음.
6. 실제 서버·배포환경에서 정상/실패/불명·재고 보상·OrderConfirmed와 Cooking 등록 지연 확인. 이 Mock QA로 대체하지 않음.

Commit·Push·PR 생성·main 병합은 수행하지 않는다. 결제·권한 경계 관련 검토와 작성자 외 팀원 1명 승인이 필요한 변경으로 제출 시 명시한다.

## 사용자 수동 검수 후 보완 (2026-11-23)

- 기존 18개 미커밋 파일을 외부 감사 `checkout-192-success-review-20261123/before-source`에 보존했다. 기존 디자인과 두 진입 경로를 유지하고 주문 내역·마이페이지·새 Checkout 경로는 추가하지 않았다.
- 시작 시 HEAD는 기존 `ca43852c7f2a87eeebfa7b09896ec4f0a8f84e25`, Staging은 0개다. fetch 결과 최신 main은 `7e7ba494b208631cef60ac47bc6fcd76b754c53c`(Cooking 로그 설정 1개 추가)이며 통합하지 않았다. PR #148·#132 미병합, #188은 병합 없이 Closed/Draft 상태다. 위 최초 조사 시점의 PR 상태와 구분한다.
- 수정 전 새 Chromium 4건 모두 FAIL: 장바구니 미정리, 즉시 주문 완료 메뉴 버튼 부재, 현재 수량 1/4 변경 시 미정리. 신규 Node 후처리 테스트는 구현 부재/콜백 미실행 실패를 확인한 뒤 수정했다.
- 세부 실행 결과와 전후 Git·보호 파일 검증은 위 외부 감사 경로에 별도로 보존한다. 최초 QA 결과는 과거 기록이며 새 결과와 합산하지 않는다.
- 보완 후 최종: Node **100 PASS / 0 FAIL**(기존 84 + 신규 16), Chromium **31 PASS / 0 FAIL**(기존 23 + 신규 8). 기존 전체 시나리오도 이번에 재실행했다. Vite production build·제품 번들 경계·변경 20개 파일 Prettier·diff 공백 검사 통과. 실제 Auth/Order/Cooking 서버 성공 검증은 아니다.
- 이번 보완에서 수정한 기존 작업 파일 7개: `src/App.jsx`, `src/checkout/checkoutFlow.js`, `src/components/CheckoutPage.jsx`, `tests/checkout.test.js`, `tests/checkout-browser-entry.jsx`, `tests/checkout-browser.mjs`, 이 문서. 신규 2개: `src/checkout/checkoutCompletion.js`, `tests/checkoutCompletion.test.js`. 최초 변경 18개를 유지한 전체 범위는 20개이며 Staging은 비어 있다.
