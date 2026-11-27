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
| O-01 | 주문 생성(OR-01): 접수 상태·Cooking 장애 503·Menu 검증·재고 확보·입력 경계 | PASS | 정상: 주문 12·15·16·17 생성 `201`, `CREATED`, 합계 금액 정확, `holdExpiresAt`은 주문 시각 + 5분, 메뉴 3 `reserved_qty` 0 → 1 반영. 경계: 수량 0·100·-1과 빈 항목은 `400 INVALID_REQUEST`, 없는 메뉴·판매 중지 메뉴·없는 옵션은 `409 MENU_NOT_AVAILABLE`, 재고 부족(수량 99)은 `409 OUT_OF_STOCK`이며 모든 거절 요청이 재고(`reserved_qty`)를 늘리지 않음. 11/27 추가: 항목 20개 `201`(경계 성공, 결제 전 취소 `200`으로 재고 확보 해제)·21개 `400`, 접수 닫힘·영업 닫힘 모두 `409 STORE_NOT_ACCEPTING_ORDERS`(관리자 OR-07로 약 1초 닫았다 복원, 복원 후 `isOpen`·`acceptingOrders` true 재조회). 옵션 이름 255자 초과는 dev 옵션 이름이 짧아 재현할 수 없어 단위 테스트 기준. **Cooking 장애 시 `503`(11/27 12:39~12:42, 직접 진행·Discord 공지)**: Cooking을 `scale --replicas=0`으로 0개(12:39:49 요청, Pod 종료 12:40:01) → Order 로그 `WARN Cooking … 3회 연속 실패하여 신규 주문·결제를 차단` 12:40:13, 5초 간격 주문 시도의 첫 `503 COOKING_UNAVAILABLE` 12:40:17(이전 마지막 `201` 12:40:12), 결제 전 주문의 새 결제도 `503`. 복구(12:41:03 요청) → Cooking Ready 12:41:29(`lastTransitionTime 03:41:29Z`) → Order 로그 `INFO … 다시 허용` 12:41:33, 첫 `201` 12:41:37, 같은 주문의 결제 `200`(확보 TTL 5분 안). 차단까지 약 24초(Pod 종료 12초 + health 3회 5초 간격), 해제까지 Ready 뒤 약 4초. 김지윤 CT-08 F-02의 Order 쪽 기록을 이 값으로 갈음 | Gateway 경유 curl(고객 토큰), `inventories` 조회 | 11/26 15:11~16:0x |
| O-02 | 결제(OR-02): 성공·실패·반복 호출·재고 확정·orderNo | IN PROGRESS | 성공: 주문 15·16·17 `200 PAID`·`orderNo` 발급, 같은 주문 재요청도 `200`·같은 `orderNo`, `payments` 한 건(DB `APPROVED`, Payment 응답 `SUCCESS`), 재고 확보 `CONFIRMED`. 실패: 주문 12가 Payment 모의 결제 실패 시간대(15:07~, 다른 팀원 시험)에 걸려 `402 PAYMENT_FAILED`, 재결제 `409 ORDER_NOT_PAYABLE`, `payments 9023 FAILED`, 재고 확보 `RELEASED`(해제). 의도한 결제 실패 시험(P-04)은 정진혁 소관 | curl, `payments`·`inventory_reservations` 조회 | 11/26 15:12~15:28 |
| O-03 | 주문 조회(OR-03·04): 본인 주문만·타 사용자 404·페이지·조리 상태 | PASS | 상세 `200`에 조리 상태(`cooking`: `WAITING`·`COOKING`, 앞 대기·예상 대기 시간) 포함, 목록은 최신순이며 결제 실패·만든 직후 상태는 제외. **고객 간 격리**: 두 번째 고객 계정(customer3-demo)으로 customer-demo의 주문 15·21·22를 조회하면 모두 `404`(본인 조회는 `200`), customer3-demo의 목록은 총 0건. 쓰기 요청 격리: customer3-demo가 customer-demo의 완료된 주문 21을 취소·결제하려는 요청도 모두 `404`(완료 주문이라 결함이 있어도 상태가 바뀌지 않는 주문으로 시험) | curl(고객 토큰 두 개, 토큰·비밀번호는 기록하지 않음), 목록 출력 | 11/26 15:2x, 18:0x |
| O-04 | 주문 취소(OR-05): 조리 전 취소·재고 복원·환불·재시도 상한 | IN PROGRESS | 정상 취소(주문 17, 조리 대기 중): `CANCELED`, 결제 `REFUNDED`·환불 `COMPLETED` 한 건, 재고 확보 `RESTORED`, 조리 전표 `CANCELED`, 같은 주문 재취소도 `200`·같은 `canceledAt`·환불 한 건 그대로. 조리 시작 후 취소(주문 15): `409 COOKING_ALREADY_STARTED`, 결제 `APPROVED`·재고 `CONFIRMED` 그대로(부작용 없음). 결제 직후 취소(주문 17 첫 시도): `409 COOKING_ORDER_PENDING`(Cooking 접수 전). **환불 실패 후속(주문 22, Payment 0개 약 11초 동안 취소)**: 취소 `200`·`CANCELED`, 재고 `RESTORED`, Order 로그 17:06:13 `WARN 취소 후 환불 실패, 재시도 대상으로 남깁니다 orderId=22 paymentId=9032 code=PAYMENT_SERVICE_UNAVAILABLE`, `cancel_follow_up_attempts 1`, Payment 복원 뒤 재시도로 `refunded_at 17:07:11`(취소 후 약 58초), 결제 `REFUNDED`·환불 `COMPLETED` 한 건, 수동 확인 표시 없음. 재시도 상한(12회) 도달·수동 확인 표시는 시간이 오래 걸려 미확인(단위 테스트 기준) | curl, `orders`·`payments`·`payment_refunds`·`inventory_reservations`·`cooking_tickets` 조회 | 11/26 15:2x~17:07 |
| O-05 | 관리자 API(OR-06~09) | PASS | OR-06 조회 `200`, OR-07 PATCH `200`(영업·접수 켬, 재조회 `true`/`true`), 잘못된 본문(문자열 `"true"`·숫자 `1`·빈 `{}`)은 `400`으로 거절되고 상태 불변. OR-08 목록 `200`, `status=CANCELED`(17·10·7·5)·`orderNo`(주문 17 한 건)·날짜 `from/to`(오늘 11건)·`manualReviewRequired=true`(0건) 필터 동작, 잘못된 날짜 형식 `400`. OR-09 상세 `200`, 없는 주문 `404`. 미확인: OR-08 페이지 이동, 관리자 화면(프런트) 연동(이은제) | Gateway 경유 curl(관리자 토큰, 토큰 값은 기록하지 않음), #398 댓글 | 11/26 14:19~16:2x |
| O-06 | 인증·신원·권한 | PASS | 토큰 없음 401, 위조 헤더(`X-User-Role: STORE_ADMIN`)만 401, 허용하지 않은 메서드·`/internal/**`·`/actuator/**` 404, CUSTOMER 토큰으로 관리자 경로 403, STORE_ADMIN 토큰으로 고객 경로 403 | Gateway 경유 curl(토큰 값은 기록하지 않음), #398 댓글 | 11/26 |
| O-07 | 이벤트·Outbox: OrderConfirmed 발행·중복·지연·복구 | IN PROGRESS | 정상 경로 PASS: 주문 20 결제(16:37:37) 직후 Order `outbox_events`에 `OrderConfirmed` 한 건이 만들어져 0.65초 만에 `SENT`, Cooking 전표 한 건(`COOKING`), 조리 완료 후 Cooking `DONE`·Order `COMPLETED`(`completed_at 16:39:38`). **이벤트 중복(CT-06 M-02, 김지윤 주관, 11/27)**: Cooking 큐에 같은 OrderConfirmed를 주문 27·17에 대해 3번 다시 넣었고 Cooking이 모두 중복으로 무시(Cooking 확인). Order 쪽 확인: 주문 27 `COMPLETED`·17 `CANCELED`가 그대로(`updated_at`·상태 이력 변화 없음), `processed_events` 마지막 처리 11:09:33(제 주문 39)·`outbox_events` 마지막 생성 11:07:32·`pending 0`으로 시험 시간대 새 이벤트 없음, Order 로그에 주문 17·27 줄 없음. 이벤트 지연·RabbitMQ 장애 복구는 장애 주입이라 `NOT RUN`(공지·조율 후). 11/25 Order 2 Pod 시험의 outbox 중복 없음 결과(이전 이미지)도 있음 | `outbox_events`·`cooking_tickets`·`orders` 조회, curl | 11/26 16:37~16:40 |
| O-08 | 관측성: `order_outbox_pending`, `order_inventory_hold_rejected_total`, ECS 로그 | PASS | 지표: `order_outbox_pending 0.0`, `order_inventory_hold_rejected_total{reason="insufficient_stock"}`가 재고 부족 요청 후 노출(11/26~27, 읽기). 로그(#425 이미지 `sha-7ba14a6`, 11/27 11:07 주문 39~42): 요청당 INFO 한 줄로 `주문 생성`, `결제 완료 주문 확정`(orderNo), `주문 취소 확정`, `취소 후 재고 복원 완료`, `취소 후 환불 완료`(paymentId), `결제 전 주문 취소`, `주문 종료`(reason=OUT_OF_STOCK), `조리 완료 반영`(orderNo·eventId)이 `orderId`로 이어짐. 최근 15분 로그에서 password·Bearer·eyJ·secret·token 검색 결과 없음. 미확인: 같은 주문 재취소의 멱등 재처리 문구, 이미 완료된 주문에 CookingCompleted가 다시 올 때의 WARN(CT-06 M-02) | `kubectl logs deploy/order-service`(orderId 검색), `/actuator/prometheus` | 11/26~27 11:07 |

## 2. HPA·리소스·오토스케일링

| ID | 내용 | 상태 | 실제 결과 | 근거 | 일시 |
|---|---|---|---|---|---|
| H-01 | 여섯 서비스 dev HPA(min 1·max 3·CPU 70%)와 Application 상태 | PASS | Order 1/3·`cpu: 10%/70%`·Synced/Healthy 확인. 나머지 서비스는 각 반영 시점에 `TARGETS` 표시와 Synced/Healthy 확인 | `kubectl get hpa`, `get application` | 11/26 11/27 12:2x 재확인(Payment·Menu·Inventory·Order 새 이미지 롤링 이후): 여섯 HPA 모두 `TARGETS` 정상(CPU 2~10%)·`REPLICAS 1`, 서비스 Pod 전부 `1/1`·재시작 0 |
| H-02 | 2 Pod 동시성(결제·재고·조리 전표·세션·조회) | PASS | Order·Cooking·Inventory·Auth(11/25), Payment·Menu(11/26) 모두 통과. Order는 최신 이미지(#425)로 11/27 재확인: 같은 주문을 두 Pod(w2·w1)에 동시에 결제하면 `PAID` 1건·`ORDER_PAY_IN_PROGRESS` 3건·결제·주문번호·`OrderConfirmed` 이벤트 각 1건, 같은 주문을 동시에 취소하면 `CANCELED` 1건·`ORDER_PAY_IN_PROGRESS` 3건·환불·재고 복원·조리 취소 각 1건(순차 재취소는 `200`·같은 `canceledAt`) | #186 댓글, #362·#367 댓글 | 11/25~26 |
| H-03 | 부하 시 확대·축소(1 → 3 → 1)·노드 배치·오류율 | PASS | 여섯 서비스 모두 1 → 3 확대·오류 0·축소 3 → 1, 확대 Pod는 워커(w1·w2)에만 배치, Menu는 새 Pod 준비 뒤 세 Pod 모두 부하 수신 | #186 댓글(11/25 마무리·11/26 보충) | 11/25~26 11/27 Order 재확인(최신 이미지): Gateway 경유 `GET /api/v1/orders` 6,000건(동시 10, `curl -Z` 한 프로세스) 전부 `200`, 1 → 3 확대(약 25초, 새 Pod w2·w1, cp 없음), 약 5분 안정화 뒤 3 → 2(11:44) → 1(11:47) 축소 |
| H-04 | 롤링 업데이트 무중단·롤링 중 DB 연결 예산 | PASS | 11/25 Order 롤링 중 요청 끊김 없음, 11/26 Payment·Menu·Order 롤링에서 새 Pod 1/1·재시작 0·이전 Pod 정상 종료 | `kubectl rollout`·`get pods -w`, #186 댓글 | 11/25~26 |
| H-05 | 통합 테스트 중 HPA 영향 구분 | PASS(관찰) | 롤링 직후 JVM 기동 CPU 급증으로 HPA가 일시 1 → 2~3으로 확대된 뒤 약 5분 뒤 축소됨을 Payment·Menu에서 확인 | `kubectl get hpa -w` | 11/26 |

## 3. 공동 테스트 (주관)

| ID | 내용 | 상태 | 비고 |
|---|---|---|---|
| CT-05 | 주문 취소·재고 복원·환불 | IN PROGRESS | 네 경로를 Order·Payment·Inventory·Cooking에서 확인: 정상 취소(주문 17), 조리 시작 후 거절(주문 15), 접수 처리 중 거절(주문 17 첫 시도), 환불 실패 후 재시도 복구(주문 22). 확인 완료: 김지윤(Cooking, Loki·지표 교차 확인), 정진혁(Payment 9028·9026 확인, 16:55). Inventory 담당은 미정으로 확인 대기. **대기 중 취소 후 뒤 주문의 대기 순번 감소(김지윤 제안, 주문 23~26, 17:49:44)**: 주문 24 취소 `200`, 뒤 주문 25는 `앞대기 1 → 0`·예상 대기 236 → 113초, 주문 26은 `앞대기 2 → 1`·356 → 233초로 각각 123초 감소(취소 주문 조리 시간만큼), 조리 중인 주문 23은 영향 없음. 이후 최종 상태: Cooking 23·25·26 `DONE`, 24 `CANCELED`, Order 23·25·26 `COMPLETED`, 24 `CANCELED`(취소 주문을 건너뛰고 정상 완료). **응답 유실(환불 쪽, 주문 30, 11/27 10:04)**: 결제 9040을 Payment에서 먼저 환불(`REFUNDED`)한 뒤 Order가 취소하며 환불을 다시 요청 → 취소 `200 CANCELED`, `stock_restored_at 10:04:59.219`·`refunded_at 10:04:59.231`, `cancel_follow_up_attempts 0`, 환불 `COMPLETED` 한 건 유지, 재고 `RESTORED`·조리 `CANCELED`. 미확인: 취소·조리 시작 동시 경쟁, 같은 주문 동시 취소(2 Pod), 재시도 상한 도달 |
| CT-04 | 결제 실패·중복·응답 유실 (주관 정진혁, Order 쪽 확인) | IN PROGRESS | **응답 유실(결제 쪽, 주문 31, 11/27 10:06)**: 결제 전(`CREATED`) 주문 31에 대해 Payment에서 같은 키(`order-31`)·같은 금액(3500)으로 먼저 결제(9041, DB `APPROVED`·Payment 응답 `SUCCESS`)한 뒤 Order가 결제를 요청 → `200`·`PAID`, 주문번호 `261127-0005`, `payment_id 9041`(먼저 만든 결제와 일치), `payments` 한 건 유지. 환불 쪽 응답 유실은 CT-05(주문 30) 참조. Payment 로그는 저장 시점의 `결제 처리`·`환불 완료`만 있고 Order의 재요청 시점에는 줄이 없음(코드상 재생은 로그를 남기지 않음, DB 한 건 유지가 근거). **정진혁(Payment) 확인 완료(11/27)**: Payment 조회 결과 결제 9040 `REFUNDED`, 9041 `SUCCESS`(DB `APPROVED`)로 위 결과와 일치. 결제 실패(Mock FAIL) 흐름은 정진혁 P-04 결과 참조 |
| CT-07 | 다중 Pod·HPA·DB 연결 예산 | IN PROGRESS | Order는 11/27에 최신 이미지로 재확인 완료(부하·확대·축소·2 Pod 동시 결제·동시 취소, H-02·H-03 행 참조, cp available 1Gi 이상 유지·Discord 공지 후 진행). 평소 DB 연결(11/27 12:2x, 읽기): auth_dev 1·cooking_dev 2·inventory_dev 1·menu_dev 1·order_dev 1·payment_dev 1(합 7), 여섯 서비스 HPA·Pod 정상(H-01 행 참조). 미실시: 다른 서비스의 부하·확대 재확인(최신 이미지), Order 확대 중 DB 연결 수 재측정, 부하 중 Pod별 CPU 분포 |

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
- 11/26 Payment 결제 실패 모드 전환: 정진혁이 P-04 시험으로 15:08 `PAYMENT_MOCK_RESULT=FAIL`로 바꿨다가 15:13 `APPROVE`로 복원했다(Discord 공지 후 진행, 정진혁 #404). 그 사이 15:12에 한 제 주문 12의 결제가 `402 PAYMENT_FAILED`로 거절됐고, 이후 Deployment가 원래 설정으로 돌아왔다(새 ReplicaSet `884479744`는 15:07:38 생성).
- Access 토큰 수명은 900초(15분)라 시험 중 `401 Jwt is expired`가 나올 수 있다. 재로그인한다.
- 11/26 17:06 환불 실패 시험(CT-05): Payment를 `kubectl scale --replicas=0`으로 약 11초 동안 0개로 두었다가 `--replicas=1`로 복원했다(Discord 공지·정진혁 확인 후 진행, cp available 1236Mi 확인). 그 사이 한 취소 요청이 `200`으로 끝나고 환불은 재시도로 완료됐다.
- 11/27 10:00경 응답 유실 시험(CT-04·05): Pod를 끊지 않고 Payment 내부 API(`port-forward`)를 직접 호출해 Payment가 먼저 처리한 상태를 만들었다(정진혁에게 사전 안내, 환불 쪽 주문 30·결제 9040, 결제 쪽 주문 31·결제 9041, 조리 차단 주문 28·29). 공유 설정은 바꾸지 않았고 시험 주문은 삭제하지 않았다.
- Payment 결제 상태 표기: DB `payments.status`의 `APPROVED`는 Payment API 응답에서 `SUCCESS`로 내보낸다(`PaymentResponse` 매핑). 이 문서의 `APPROVED`는 DB 값이고 정진혁의 Payment 조회·응답 기준 표기는 `SUCCESS`다.
- 11/27 10:45 #425(Order 상태 변경 로그, 이슈 #423) 병합 후 이태훈 자동 태그 PR #439로 dev Order 이미지를 `sha-7ba14a6f…`로 갱신했고 롤링은 정상(새 Pod 1/1·재시작 0). 이은제 요청 변경(실제 전이만·커밋 뒤에만 로그, 이미 처리/완료 구분, `eventId` 추가)을 반영한 커밋(`79a1031`)이 들어 있다.

## 관련 이슈·PR

- #186, #225·#312·#313·#344·#362·#367 (HPA·시험 결과)
- #295, #320 (Order 종료 보호·HPA)
- #398, #399 (Order 관리자 API dev 공개)
- #410 (이 문서)
