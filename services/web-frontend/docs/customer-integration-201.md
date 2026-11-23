# 고객 Menu·Auth·Checkout 통합 및 HTTP 클라이언트 — #201

## 기준과 재사용

- 최신 fetch 기준 main: `df30b94bd5471a675de7f73be6400ae91b3f52f6`.
- 브랜치: `feat/201-customer-checkout-http`; worktree: `C:\M\Peak_Order-201-customer-integration`.
- #148 Open/미병합, HEAD `a271576ff263200b155e2f9824d7b1d71632bda2`.
- #188 Closed/Draft/미병합, HEAD `c5f5af5e84d3be97dc7dd022683f9349e1280fdf`. 보존된 Auth 코드를 재사용했다. PR 종료를 코드 폐기나 병합으로 해석하지 않았다.
- #200 Open/미병합, HEAD `7f97b76eb06c261835d524394e380f841ce9cb92`.
- `C:\M\Peak_Order-156-148-integration`의 검증된 32개 frontend 파일을 재사용했다. 기존 README·App·CSS·fixture·Vite 충돌 해결을 다시 만들지 않았으며, Checkout 연결에 필요한 부분만 추가했다.
- `integration-handoff.txt`, `boundary-20261123/handoff-update.txt`의 B2·D3·E1 수정 근거를 확인했다. Store 인증 무효화 시 이전 의도 제거, 상세 닫기 시 의도 취소, 대기 중 선택 메뉴 HTTP 재검증·캐시/오래된 응답 차단을 유지했다.
- 기존 통합 worktree의 HEAD `aa4951682e2a6c0f78c00f5a693c0d74d11bc88e`, MERGE_HEAD·Staging 21개를 그대로 두었다. #201은 main 기반 미커밋 파일 구성으로 통합했으며 원본 브랜치/인덱스에는 병합·Commit하지 않았다.

## 계약 근거와 확인 한계

[Notion API 원본](https://www.notion.so/4102f07e9478802f91a4da2ae18ab56f)은 확인 시 2026-11-19 편집본이며 본문에 **초안·팀 승인 필요**로 표시돼 있다. 검색 가능한 별도 최종 승인 API 문서는 확인되지 않았다. 따라서 문서의 모든 내용을 확정 계약으로 주장하지 않는다. 이전에 확인한 최신 설계 결정과 현재 main의 Controller/DTO/Service·오류 코드 및 합의 근거가 연결된 `docs/api/cooking-co02.md`를 대조해 구현했다. 서버 계약을 신설하거나 변경하지 않았다.

| 기능  | 실제 요청                                                                 | 적용                                                                                                        |
| ----- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| CO-02 | POST `/api/v1/cooking/estimates`, `{items:[{menuId,quantity,optionIds}]}` | 공개 HTTP 조회. expectedWaitSec=시작까지, cookSec=선택 조리시간, expectedReadySec=완료까지, 초 단위·합 검증 |
| OR-01 | POST `/api/v1/orders`, 동일한 items 구조                                  | HTTP 201·CREATED·orderId·holdExpiresAt·항목/옵션/수량·정수 금액/합계 검증. orderNo 없음                     |
| OR-02 | POST `/api/v1/orders/{orderId}/pay`, 본문 없음                            | HTTP 200·Order 응답 검증. 결제수단·사용자 ID·프런트 가격·멱등키를 보내지 않음                               |
| OR-04 | GET `/api/v1/orders/{orderId}`                                            | 결과 불명 복구에 필요한 본인 주문 상세만 사용. ID·주문 항목 일치 확인. CREATED만으로 미결제 판정 금지       |
| OR-03 | 이번 화면에서 호출하지 않음                                               | 주문 내역은 범위 밖. 결과 불명 생성의 ID를 모르면 목록 검색으로 임의 추정하지 않음                          |

Order `CreateOrderRequest`와 Cooking DTO에 맞게 항목은 1~20개, 수량은 1~99로 제한한다. HTTP adapter는 옵션 최대 20개·양수 ID·중복 금지를 검증하며, 현재 화면은 기존 단일 radio 옵션 정책을 유지한다. 장바구니 21개 항목은 분할 주문·부분 주문을 새로 만들지 않고 진입 전에 안내하고 보존한다.

Order 응답의 항목·옵션·수량과 요청을 비교하고 unitPrice×quantity=lineAmount, 항목 합=totalAmount, 안전한 정수/서버 int 범위, 상태·결제 후 번호·CREATED 확보 시각을 검사한다. 서버 재계산 금액이 다르면 이를 표시하고 새 금액의 결제 버튼을 사용자가 다시 눌러야 한다. 예상시간 조회만으로 재고 확보·주문·조리 등록을 확정하지 않는다. PAID 이후 조리 등록은 비동기이므로 완료된 것으로 표시하지 않는다.

## 인증·실패·중복 경계

- Order는 기존 Auth Store의 `request`로 메모리 Access Token의 Bearer를 전달한다. CUSTOMER와 사용자 식별자를 확인한다. Refresh HttpOnly 쿠키는 브라우저가 처리한다. 프런트가 `X-User-Id`를 만들거나 내부 Payment/Inventory API를 호출하지 않는다.
- 로그인·최초 복원·같은 탭 Refresh single-flight·로그아웃과 403 무갱신을 재사용한다. 안전한 OR-04 GET만 401 후 최대 1회 회전/재시도를 허용한다. OR-01/02 POST의 401은 세션을 무효화하며 자동 재생하지 않는다.
- 코드와 HTTP 상태가 함께 일치하는 명시적 종료 오류만 실패 확정으로 처리한다. 생성의 INVALID_REQUEST(400), STORE_NOT_ACCEPTING_ORDERS/MENU_NOT_AVAILABLE/OUT_OF_STOCK(409), COOKING_UNAVAILABLE(503); 결제의 PAYMENT_FAILED(402), HOLD_EXPIRED/STOCK_CONFIRM_FAILED/ORDER_NOT_PAYABLE/MENU_NOT_AVAILABLE(409).
- ORDER_PAY_IN_PROGRESS, 결제 5xx, 깨진/모순된 응답, 네트워크·타임아웃·취소는 실패 확정으로 취급하지 않는다. 결과 불명은 같은 orderId로 조회만 제공한다. 임의 새 주문·재결제는 실행하지 않는다.
- 성공 전후 세션·계정·generation·AbortSignal과 flow identity를 검사한다. 화면 종료·계정 변경 뒤 늦은 응답은 주문 화면을 복원하거나 장바구니를 변경하지 않는다.
- 성공 확정 후 장바구니 주문만 주문 당시 수량을 한 번 차감한다. 추가된 수량·다른 옵션·비주문 품목은 유지한다. 즉시 주문·실패·결과 불명은 불변이며 조회 후 성공도 동일한 후처리 경로를 사용한다. 저장 키/형식 `peak-order.cart.v1` 유지.
- 두 경로 모두 완료 후 메뉴로 이동하고 완료 Checkout History entry를 정리한다. 로그인 전 선택·옵션·수량과 기존 메뉴/장바구니 캐시 준비·재시도 정책을 유지한다. 주문 내역·마이페이지·새 Checkout 진입 경로·다중 탭 정책은 추가하지 않았다.

## 실행

Node 24.22.3 / npm 11.19.1. 새 라이브러리·lockfile 변경 없음.

```powershell
cd services/web-frontend
npm.cmd test
npm.cmd run build
npm.cmd run dev -- --host 127.0.0.1
```

제품은 같은 origin의 `/api/v1`을 호출한다. dev Proxy는 `GATEWAY_API_TARGET`으로 공통 Gateway를 지정하거나 `MENU_API_TARGET`, `AUTH_API_TARGET`, `ORDER_API_TARGET`, `COOKING_API_TARGET`을 명시할 수 있다. 제품 번들용 VITE 환경 변수로 비밀값을 넣지 않는다. Origin 관련 헤더를 프런트에서 위조하거나 Cookie 보안 속성을 완화하지 않는다. 별도 URL이 없으면 Order/Auth/Cooking Proxy를 임의 서버로 연결하지 않는다.

로컬 계약 HTTP 체험은 다음과 같다. **실제 dev 서버가 아니다.**

```powershell
npm.cmd run test:customer:ui
npm.cmd run test:customer:ui -- unknown-paid
```

출력한 loopback URL에서 합성 `customer@example.test` / `fixture-only-password`로 테스트한다. success/declined/unknown/unknown-paid/stock/closed/unavailable/expired/estimate-error 시나리오를 선택할 수 있다. 기존 `test:checkout:ui`는 #192 메모리 Mock 회귀 체험용으로 유지한다. 이 테스트 entry·합성 세션/서버·Mock adapter는 제품 번들에 포함되지 않는다.

## 검증

- 구현 전 신규 HTTP 계약 테스트는 adapter 부재로 실패하는 초기 결과를 기록했다.
- 전체 React Node **167 PASS / 0 FAIL**, 기존 통합 112건·Checkout 경계/후처리·번들 및 신규 HTTP 계약 17건 포함. HTTP 테스트는 실제 loopback HTTP 요청/본문/헤더·빈 pay 본문·401 GET 1회 재시도/POST 무재시도·403·오류/상태 쌍·응답 이상·네트워크 단절·항목 제한을 확인한다.
- 실제 Chromium의 새 고객 통합 HTTP **17건**: 데스크톱·모바일의 두 진입 경로, 세션 복원/로그아웃·CUSTOMER/STORE_ADMIN, 성공/거절/불명, 조회 성공 시 1회 차감, 가격 변경·만료·장애·품절·판매/접수 중지, 21개 제한, 늦은 PAID 응답 중 로그아웃/계정 변경/화면 종료.
- 이전 Auth 9·Menu 6·로그인/메뉴 경합 1·경계 보완 11건을 재실행했다. #192 Mock UI 31건도 유지한다. 통합된 CUSTOMER 경계가 장바구니 진입부터 STORE_ADMIN을 막으므로 이전 Mock 테스트의 관리자 접근 시도만 현재 UI에 맞게 보정했다. 이를 제품 결함으로 세지 않는다.
- 스크립트 예외와 의도하지 않은 콘솔 오류는 실패로 처리한다. 초기 Refresh 401·의도한 업무 실패 HTTP 리소스 오류·닫기 시 abort는 기대한 실패/취소로 구분해 새 QA 결과에 기록한다.
- SSR·Node 검사를 브라우저 성공으로 간주하지 않는다. production-compiled React를 실제 Chromium으로 렌더링했다. StrictMode wrapper만으로 개발 모드 이중 effect를 검증했다고 주장하지 않는다.
- 실행 로그·결과 JSON·화면·원본/최종 해시는 `C:\M\Peak_Order-local-audits\issue201-20261123`에 보존한다. 전체 Prettier의 기존 CRLF 경고와 구분해 변경 파일만 검사한다.

## 실제 dev 연동의 남은 의존성

1. **Auth/Gateway/Order 담당:** 현재 main `OrderController`는 임시 `X-User-Id`를 요구한다. Bearer JWT를 검증하고 신뢰할 수 있는 사용자 식별을 전달하는 방식 또는 Order 직접 검증 계약을 확정/구현해야 한다. 이 작업에서 헤더를 만들어 우회하지 않았다. 현재 백엔드에 곧바로 연결하면 인증/사용자 식별 때문에 주문이 성공한다고 보장할 수 없다.
2. **Auth·배포/Gateway 담당:** dev Auth 활성화, HTTPS Secure/HttpOnly/SameSite=Strict Refresh Cookie, Origin/Referer·CORS·CSRF와 `/api/v1` 라우팅을 실제 환경에서 검증해야 한다. loopback 테스트의 테스트용 Cookie는 배포 정책 증거가 아니다.
3. **Order/Cooking/Menu/Inventory/Payment 담당:** 실제 응답·접수 설정·재고 확보/확정/해제·OrderConfirmed 전달/조리 전표 등록 지연·장애 보상을 11/25 이후 dev 통합에서 검증해야 한다. 프런트가 서버 업무 처리를 대신하거나 완료를 위조하지 않는다.
4. 응답 유실로 생성 ID를 받지 못한 경우, 새로고침·재접속·다중 탭의 미확정 결제 복구 및 계정별 장바구니 소유/이관은 별도 합의 대상이다. 이번 메모리 화면의 안전 가드가 영속 복구·탭 간 원자성을 보장하지 않는다.

Commit·Push·PR 생성·main/기존 브랜치 병합은 하지 않았다. 인증·결제 정합성 변경이므로 후속 제출 시 작성자 외 팀원 1명 승인 필수 대상임을 명시한다.
