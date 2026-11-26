# Order·HPA 통합 테스트 — 김민규

- 담당: Order Service, HPA·리소스 관리·오토스케일링(Order·Cooking·Inventory·Auth·Payment·Menu dev 배포), Order 애플리케이션 관측성
- 공동 테스트 주관: CT-05 주문 취소·재고 복원·환불, CT-07 다중 Pod·HPA·DB 연결 예산
- 상태 값: NOT RUN / IN PROGRESS / PASS / FAIL / BLOCKED / RETEST
- 이 문서는 테스트를 진행하면서 계속 갱신한다. 비밀번호·토큰은 기록하지 않는다(터미널 변수로만 사용).

## 테스트 환경

| 항목 | 값 |
|---|---|
| 환경 | dev (Gateway `10.10.22.100` 포트 80, 클러스터 `kubectl`, 서비스별 DB) |
| Order 이미지 | `sha-6219d6bf419ca733376c317fcbc4bbbd4d38ba5b` (11/26 #371) |
| Order 설정 | Hikari 4/1, preStop 10초·종료 유예 50초(#295), HPA min 1·max 3·CPU 70%(#320), `ORDER_ADMIN_ENABLED=true`(dev, #399) |
| 테스트 계정 | customer-demo(CUSTOMER), admin-demo(STORE_ADMIN) (비밀번호는 기록하지 않음) |
| 공유 설정 변경 | 영업·주문 접수 켬(11/26 14:19, `isOpen=true`, `acceptingOrders=true`, 초기값은 둘 다 `false`). 통합 테스트 종료 후 닫음으로 복원. Discord 공지 완료 |
| 테스트 데이터 | Payment 시험 기록 order_id 910001·910002·910100~919099(김민규 시험), order_id 999001·999002(다른 팀원 데이터, 변경·삭제하지 않음) |

## 1. Order Service

| ID | 내용 | 상태 | 실제 결과 | 근거 | 일시 |
|---|---|---|---|---|---|
| O-01 | 주문 생성(OR-01): 접수 상태·Cooking 장애 503·Menu 검증·재고 확보·입력 경계 | NOT RUN | | 영업·접수를 켠 뒤 진행 | |
| O-02 | 결제(OR-02): 성공·실패·반복 호출·재고 확정·orderNo | NOT RUN | 11/25 Order 2 Pod 시험에서 같은 주문 동시 결제는 200 한 개·409, 주문번호 한 번 발급(이전 이미지 기준) | 최신 이미지로 재시험 예정. 이전 결과는 #186 댓글 | |
| O-03 | 주문 조회(OR-03·04): 본인 주문만·타 사용자 404·페이지·조리 상태 | NOT RUN | 고객 토큰의 `GET /api/v1/orders`는 200 | O-01 이후 상세·격리 확인 | 11/26 |
| O-04 | 주문 취소(OR-05): 조리 전 취소·재고 복원·환불·재시도 상한 | NOT RUN | | CT-05와 함께 진행 | |
| O-05 | 관리자 API(OR-06~09) | IN PROGRESS | OR-06 조회 200, OR-07 PATCH 200(영업·접수 켬, 재조회 `true`/`true`), OR-08 목록 200. OR-09 상세와 OR-08 검색 조건은 미확인 | Gateway 경유 curl(관리자 토큰), #398 댓글 | 11/26 14:19 |
| O-06 | 인증·신원·권한 | PASS | 토큰 없음 401, 위조 헤더(`X-User-Role: STORE_ADMIN`)만 401, 허용하지 않은 메서드·`/internal/**`·`/actuator/**` 404, CUSTOMER 토큰으로 관리자 경로 403, STORE_ADMIN 토큰으로 고객 경로 403 | Gateway 경유 curl(토큰 값은 기록하지 않음), #398 댓글 | 11/26 |
| O-07 | 이벤트·Outbox: OrderConfirmed 발행·중복·지연·복구 | NOT RUN | 11/25 Order 2 Pod 시험에서 outbox 중복 발행 없음(Cooking `duplicate` 0, 이전 이미지 기준) | 최신 이미지로 재시험 예정 | |
| O-08 | 관측성: `order_outbox_pending`, `order_inventory_hold_rejected_total`, ECS 로그 | NOT RUN | `order_inventory_hold_rejected_total`은 재고 확보 거절이 처음 생길 때 만들어져 아직 노출되지 않음(정상) | 통합 테스트 이후 진행 | |

## 2. HPA·리소스·오토스케일링

| ID | 내용 | 상태 | 실제 결과 | 근거 | 일시 |
|---|---|---|---|---|---|
| H-01 | 여섯 서비스 dev HPA(min 1·max 3·CPU 70%)와 Application 상태 | PASS | Order 1/3·`cpu: 10%/70%`·Synced/Healthy 확인. 나머지 서비스는 각 반영 시점에 `TARGETS` 표시와 Synced/Healthy 확인 | `kubectl get hpa`, `get application` | 11/26 |
| H-02 | 2 Pod 동시성(결제·재고·조리 전표·세션·조회) | PASS | Order·Cooking·Inventory·Auth(11/25), Payment·Menu(11/26) 모두 통과. 최신 이미지 재확인은 CT-07에서 | #186 댓글, #362·#367 댓글 | 11/25~26 |
| H-03 | 부하 시 확대·축소(1 → 3 → 1)·노드 배치·오류율 | PASS | 여섯 서비스 모두 1 → 3 확대·오류 0·축소 3 → 1, 확대 Pod는 워커(w1·w2)에만 배치, Menu는 새 Pod 준비 뒤 세 Pod 모두 부하 수신 | #186 댓글(11/25 마무리·11/26 보충) | 11/25~26 |
| H-04 | 롤링 업데이트 무중단·롤링 중 DB 연결 예산 | PASS | 11/25 Order 롤링 중 요청 끊김 없음, 11/26 Payment·Menu·Order 롤링에서 새 Pod 1/1·재시작 0·이전 Pod 정상 종료 | `kubectl rollout`·`get pods -w`, #186 댓글 | 11/25~26 |
| H-05 | 통합 테스트 중 HPA 영향 구분 | PASS(관찰) | 롤링 직후 JVM 기동 CPU 급증으로 HPA가 일시 1 → 2~3으로 확대된 뒤 약 5분 뒤 축소됨을 Payment·Menu에서 확인 | `kubectl get hpa -w` | 11/26 |

## 3. 공동 테스트 (주관)

| ID | 내용 | 상태 | 비고 |
|---|---|---|---|
| CT-05 | 주문 취소·재고 복원·환불 | NOT RUN | 같은 orderId로 Order 응답·Payment DB·Inventory DB·Cooking 로그를 김민규가 확인하고 근거를 기록. 정진혁(PI-03 환불)·김지윤(CI-03)·Inventory 담당(II-03·04, 미정)은 근거 확인. 환불 실패 등 장애 주입은 정진혁과 조율 |
| CT-07 | 다중 Pod·HPA·DB 연결 예산 | IN PROGRESS | 11/25~26 결과를 최신 이미지로 재확인 예정. 부하·HPA 확대는 시작 전 Discord 공지 |

## 4. DB 연결 예산 기록 (CT-07)

| 서비스 | 확인한 값 | 비고 |
|---|---|---|
| Menu | 3 Pod 부하 중 `menu_dev` 최대 12(풀 4 × 3, psql 자기 연결 제외) | 11/26 |
| Payment | 3 Pod 부하 중 `payment_dev` 최대 9(psql 자기 연결 포함이라 실제는 8 이하) | 11/26 |
| 최악 계산 | dev 여섯 서비스 최대 3 Pod·롤링 겹침 6 × 4 Pod × 4 = 96 < 서비스용 147(`max_connections` 150) | 남규리 #388 리뷰 |
- `psql -d <db>`로 연결 수를 세면 조회하는 psql 자신의 연결 1개가 포함되므로 `pid <> pg_backend_pid()`를 붙인다.

## 5. 기타 확인 기록

- 11/26 14:19 영업·주문 접수를 켰다. 그 전에는 고객 주문이 `409 STORE_NOT_ACCEPTING_ORDERS`로 막혀 있었다(정진혁의 C-01도 같은 이유로 BLOCKED).
- 11/26 #399 병합 뒤 Order 롤링: 새 Pod 1/1·재시작 0, `order-service-admin` Route·`order-service-admin-jwt` Policy 생성, `order_dev` 연결 2.
- 11/26 Payment 재생 부하(같은 주문·키·금액 재요청)는 새 결제 기록을 만들지 않았다(order_id 910100~919099 9,000건·중복 없음).

## 관련 이슈·PR

- #186, #225·#312·#313·#344·#362·#367 (HPA·시험 결과)
- #295, #320 (Order 종료 보호·HPA)
- #398, #399 (Order 관리자 API dev 공개)
- #410 (이 문서)
