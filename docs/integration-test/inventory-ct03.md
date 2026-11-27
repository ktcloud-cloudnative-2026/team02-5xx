# Inventory 통합 테스트(CT-03) — 김민규(임시 담당)

- 이슈: #456
- 담당: Inventory Service 임시 담당(남규리 님 이탈, 팀장 안내 2026-11-27), 공동 테스트 CT-03 주관
- CT-03: 재고 확보·확정·해제·TTL·동시성 (팀장 통합 테스트 계획, 2026-11-27 14:04)
- 상태 값: NOT RUN / IN PROGRESS / PASS / FAIL / BLOCKED / RETEST
- 이 문서는 시험을 진행하면서 계속 갱신한다. 비밀번호·토큰은 기록하지 않는다(터미널 변수로만 사용).
- 결함은 별도 Issue로 등록하고 수정 PR은 분리한다. 수정·재검증 결과는 이 문서에 반영한다.
- 기대 결과의 근거는 `services/inventory-service/README.md`와 `InventoryHoldService`·`HoldExpiryScheduler` 코드이며, 실제 결과는 시험 뒤 채운다.

## 테스트 환경

| 항목 | 값 |
|---|---|
| 환경 | dev (클러스터 `kubectl`, `inventory_dev` DB) |
| Inventory 이미지 | `sha-f4201cc02da14433832d1fd2bd9e773b6a133439`(11/27 15:42 `kubectl` 확인, Pod 1개·재시작 0, 시험 전 `inventory_reservations` 상태 분포 `CONFIRMED 49`·`EXPIRED 56`·`RELEASED 19`·`RESTORED 15`) |
| Inventory 설정 | `STOCK_HOLD_TTL` 5분, 만료 스케줄러 5초 간격, Hikari 4/1, HPA min 1·max 3·CPU 70%, 관리자 API dev 공개(#337) |
| 내부 API 호출 | `/internal/v1/...`는 Gateway로 노출되지 않아 Pod에 `kubectl port-forward`로 직접 호출(2 Pod 시험은 Pod별 포트 포워딩) |
| 관리자 API 호출 | Gateway 경유, admin-demo(STORE_ADMIN)·customer-demo(CUSTOMER) 토큰 (비밀번호는 기록하지 않음) |
| 시험용 데이터 | 시험 order_id는 920001~929999(다른 시험의 910001~919099, 999001·999002와 겹치지 않음). 메뉴 7(프렌치프라이, 시험 전 `stock_qty 2`·`reserved_qty 0`, 시드 3에서 다른 시험으로 1 감소)·메뉴 11(바닐라 아이스크림, `stock_qty 20`·`reserved_qty 0`)을 임시로 사용하고 시험 뒤 `reserved_qty`를 시험 전 값으로 되돌린 것을 확인한다 |
| 공유 설정 변경 | 없음(TTL·영업 상태 변경 없음). 시험 전 Discord 공지 |

시험 전후에 기록할 값: `inventories`의 메뉴 7·11 `stock_qty`·`reserved_qty`, `inventory_reservations`의 시험 order_id별 상태.

## 결과 요약 (11/27)

- 시험 19건(I-01~I-19)을 11/27 15:45~16:30에 수행했고 모두 PASS(I-05 관찰, I-17 알려진 한계, I-18 관찰 표기). 결함으로 올린 것은 없다.
- 확보·확정·해제·복원은 정상·멱등·거절 경로가 모두 README·코드 기대와 같다. 같은 메뉴 동시 확보(1 Pod·2 Pod)에서 초과 판매가 없고, 같은 orderId 동시 요청은 확보 한 개, 확정·해제 경쟁은 한 가지 결말, 만료 경계는 시각대로 갈린다.
- 알려진 한계·관찰: ① `inventory_histories` 이력 미기록(팀장 확인으로 발표 전 구현 없음, 후속 Issue) ② 재확보 시 해제된 예약을 `200`으로 반환(Order는 orderId 재사용 없음) ③ Inventory 로그가 일반 텍스트이고 업무 로그가 없음 → 팀장 요청으로 #459에서 ECS JSON·재고 상태 변경 로그를 추가하는 중(반영 뒤 Loki `orderId` 추적 확인과 로그 시험을 이 문서에 추가).
- 시험 데이터는 모두 원복했다(메뉴 7·10·11, 메뉴 6 연결, 진행 중 확보 0건).

## 1. 재고 확보·확정·해제·복원 (II-01~II-04)

| ID | 내용 | 상태 | 기대 결과 | 실제 결과 | 근거 | 일시 |
|---|---|---|---|---|---|---|
| I-01 | 확보(II-01) 정상·멱등·거절 | PASS | 정상 `200 {holdId, expiresAt}`과 `reserved_qty` 증가·예약 `RESERVED`. 같은 `orderId` 재호출은 기존 확보 반환(`reserved_qty` 한 번만 증가). 재고보다 많은 수량 `409 INSUFFICIENT_STOCK`, 재고 미연결 메뉴 `409 STOCK_NOT_LINKED`, 잘못된 본문 `400 INVALID_REQUEST`. 같은 메뉴를 한 주문에 두 번 담으면 합산 | 11/27 15:45 메뉴 11(가용 20): 정상(수량 2) `200 holdId 140`(만료 5분 뒤)·같은 orderId 재호출 `200` 같은 holdId(`reserved_qty` 한 번만 증가), 가용 초과 `409 INSUFFICIENT_STOCK`, 미연결 메뉴 `409 STOCK_NOT_LINKED`, 수량 0·빈 항목 `400 INVALID_REQUEST`, 같은 메뉴 두 번 담기 `200`에 예약 항목 한 줄(수량 2)로 합산, 거절 요청(920002)은 예약 미생성. 관찰: 재호출 응답의 `expiresAt`은 DB 왕복으로 마이크로초 정밀도(값 동일) | `ij`(내부 API 포트 포워딩) 응답, `inventories`·`inventory_reservations`·`inventory_reservation_items` 조회 | 11/27 15:45 |
| I-02 | 확정(II-02) 정상·멱등·거절 | PASS | 정상 `200`, `stock_qty`·`reserved_qty` 함께 차감·예약 `CONFIRMED`. 재호출 `200`(변화 없음). 해제·만료된 확보 `409 HOLD_NOT_ACTIVE`, 없는 holdId `404 HOLD_NOT_FOUND` | 11/27 15:46 확정 140 `200`(재고 20→18, `reserved_qty` 2 차감), 재호출 `200`(수량 변화 없음), 확정된 확보 해제 `409 HOLD_NOT_ACTIVE`, 해제된 141 확정 `409 HOLD_NOT_ACTIVE`, 없는 holdId `404 HOLD_NOT_FOUND`. 예약 140 `CONFIRMED` | `ij` 응답, `inventories`·`inventory_reservations` 조회 | 11/27 15:46 |
| I-03 | 해제(II-03) 정상·멱등·거절 | PASS | 정상 `200`, `reserved_qty`만 차감·`RELEASED`. 재호출 `200`. 이미 `EXPIRED`도 `200`. 확정된 확보 `409 HOLD_NOT_ACTIVE`, 없는 holdId `404` | 11/27 15:46 해제 141 `200`(`reserved_qty`만 2 차감, `stock_qty` 불변), 재호출 `200`(변화 없음), 없는 holdId `404 HOLD_NOT_FOUND`. 예약 141 `RELEASED`. 만료(`EXPIRED`) 예약 해제는 I-07에서 확인 | `ij` 응답, `inventories`·`inventory_reservations` 조회 | 11/27 15:46 |
| I-04 | 복원(II-04) 정상·멱등·거절 | PASS | 확정된 확보 `200 {restored:true}`, `stock_qty`만 증가·`RESTORED`. 재호출 `200`. 확정되지 않은 확보·없는 주문 `409 RESTORE_NOT_APPLICABLE`. 주문 연동 경로는 CT-05(Order 쪽)에서 확인 | 11/27 15:48 복원 920001 `200 {restored:true}`(재고 18→20), 재호출 `200`(22로 늘지 않음), 해제된 예약·없는 주문·확정 전(`RESERVED`) 예약 복원 모두 `409 RESTORE_NOT_APPLICABLE`. 예약 920001 `RESTORED`. 시험 뒤 메뉴 11 `stock_qty 20`·`reserved_qty 0`으로 원복 | `ij` 응답, `inventories`·`inventory_reservations` 조회 | 11/27 15:48 |
| I-05 | 이미 해제된 orderId로 재확보(경계 관찰) | PASS(관찰) | 코드상 같은 `orderId`의 기존 확보를 상태와 무관하게 반환한다(해제된 확보를 `200`으로 돌려줄 수 있음). Order는 orderId를 재사용하지 않으므로 업무 영향은 없는지 확인해 기록(결함이 아닌 관찰) | 11/27 15:48 해제된 order 920003을 다시 확보 요청 → `200`으로 옛 확보(`holdId 141`, 상태 `RELEASED` 그대로)를 반환, 새 확보·`reserved_qty` 증가 없음. 호출자에게는 성공으로 보이지만 해제된 예약이므로, 같은 orderId로 재확보를 요청하는 호출자가 있다면 오해할 수 있음. Order는 orderId를 재사용하지 않아 업무 영향 없음(결함 아님, 기록) | `ij` 응답, `inventory_reservations` 조회 | 11/27 15:48 |

## 2. TTL·만료 (II-01 만료, HoldExpiryScheduler)

| ID | 내용 | 상태 | 기대 결과 | 실제 결과 | 근거 | 일시 |
|---|---|---|---|---|---|---|
| I-06 | TTL 만료 | PASS | 확보 5분 뒤 스케줄러(5초 간격)가 예약을 `EXPIRED`로 바꾸고 `reserved_qty`를 되돌림. 11/27 12:50 Order 시험에서 Inventory `reserved_qty 0` 복귀는 확인했고, 여기서는 예약 상태·시각을 직접 기록 | 11/27 15:52~15:58 확보 5건(order 920501~920505, 5분 TTL)을 만들어 만료 시각(15:57:37)을 지나게 둠 → 확정을 받지 못한 3건(159·160·161)이 `EXPIRED`, 메뉴 11 `reserved_qty` 0으로 복귀(스케줄러 5초 주기, 확인 15:58) | `bound.py`(만료 경계 스크립트) 출력, `inventory_reservations`·`inventories` 조회 | 11/27 15:58 |
| I-07 | 만료 뒤 확정·해제 | PASS | `expiresAt`이 지난 확보의 확정은 스케줄러가 처리하기 전에도 `409 HOLD_NOT_ACTIVE`(코드의 `isExpired` 검사). 만료 후 해제는 `200`(멱등) | 만료 시각 도달 이후(0.0·+0.2·+0.5초) 확정은 모두 `409 HOLD_NOT_ACTIVE`, 만료된(`EXPIRED`) 확보 해제는 `200 OK`(멱등, 159·160·161), 확정된 확보 해제는 `409`. 만료 전 확보(143·144)에 확정 `200`·해제 `409`도 별도 확인(이후 복원으로 원복) | `bound.py` 출력, `ij` 응답 | 11/27 15:52~15:58 |
| I-08 | 만료 경계 경쟁(확정 vs 스케줄러) | PASS | `expiresAt` −0.3~+0.3초에 확정을 보내면 한쪽만 이긴다. 확정 성공이면 `CONFIRMED`·`stock_qty` 차감, 거절이면 `EXPIRED`·`reserved_qty` 복귀이고 두 결과가 섞이지 않음 | 만료 시각 기준 −0.5·−0.2초 확정은 `200`(`CONFIRMED`, 재고 20→18), 0.0·+0.2·+0.5초는 `409`(`EXPIRED`, `reserved_qty` 0). 만료 시각에 정확히 도달한 순간부터 거절되며 한 확보에서 확정과 만료가 섞이지 않음. 시험 뒤 확정 2건(920501·920502)을 복원해 메뉴 11을 20으로 원복 | `bound.py` 출력, `inventory_reservations`·`inventories` 조회 | 11/27 15:57 |

## 3. 동시성

| ID | 내용 | 상태 | 기대 결과 | 실제 결과 | 근거 | 일시 |
|---|---|---|---|---|---|---|
| I-09 | 같은 메뉴 동시 확보(초과 판매 방지) | PASS | 메뉴 7(가용 2)에 서로 다른 order_id 8건을 동시에 확보 요청 → 정확히 2건 `200`, 6건 `409 INSUFFICIENT_STOCK`, `reserved_qty 2`(가용 0). 이후 전부 해제해 원복 | 11/27 15:50 메뉴 7(가용 2: `stock_qty 2`·`reserved_qty 0`)에 서로 다른 order_id 8건(920101~920108)을 동시에 확보 요청 → 정확히 2건 `200`(145·146), 6건 `409 INSUFFICIENT_STOCK`, 500 없음. 성공 2건을 해제한 뒤 `stock_qty 2`·`reserved_qty 0`으로 원복 | `conc.py`(동시 요청 스크립트, 내부 API 포트 포워딩) 출력, `inventories` 조회 | 11/27 15:50 |
| I-10 | 같은 orderId 동시 확보 | PASS | 같은 orderId 8건 동시 → 모두 같은 holdId, 예약 1행, `reserved_qty` 한 번만 증가(500 없음) | 11/27 15:50 같은 order 920201을 8건 동시 확보 → 8건 모두 `200`, 같은 `holdId 147`, 예약 한 행, 500 없음. 시험 뒤 해제 | `conc.py` 출력, `inventory_reservations` 조회 | 11/27 15:50 |
| I-11 | 같은 확보에 확정·해제 경쟁 | PASS | 확정과 해제를 동시에 → 한쪽만 성공하고 반대쪽은 `409 HOLD_NOT_ACTIVE`(또는 멱등 `200`), 최종 상태가 한 가지(`CONFIRMED` 또는 `RELEASED`)이고 `stock_qty`·`reserved_qty`와 일치 | 11/27 15:50 같은 확보(148)에 확정 3건·해제 3건을 동시에 요청 → 확정 3건 모두 `200`(멱등), 해제 3건 모두 `409 HOLD_NOT_ACTIVE`, 최종 `CONFIRMED` 한 가지, 재고는 한 번만 차감(20→19). 복원으로 20 원복 | `conc.py` 출력, `inventory_reservations`·`inventories` 조회 | 11/27 15:50 |
| I-12 | 여러 메뉴 동시 확보(교착 방지) | PASS | 두 메뉴를 서로 반대 순서로 담은 요청을 동시에 → 교착·타임아웃 없이 완료(코드는 메뉴 ID 순서로 잠금) | 11/27 15:50 메뉴 10·11을 서로 반대 순서로 담은 확보 8건(920401~920408)을 동시에 요청 → 8건 모두 `200`, 교착·타임아웃 없음(요청 순서와 무관하게 메뉴 ID 순서로 잠금). 전부 해제해 `RELEASED`, 메뉴 10·11 `reserved_qty` 원복 | `conc.py` 출력, `inventory_reservations`·`inventories` 조회 | 11/27 15:50 |
| I-13 | 2 Pod 동시 확보·확정 | PASS | Pod별 포트 포워딩으로 같은 메뉴를 두 Pod에서 동시에 확보·확정 → I-09와 같은 결과. 11/25에 2 Pod PASS(HPA 시험)이며 최신 이미지로 재확인 | 11/27 16:13~16:16 Inventory를 `kubectl scale`로 2 Pod(w2·w1)로 늘리고 Pod별 포트 포워딩으로 번갈아 8건씩 동시 요청(공지 후 진행, 시험 뒤 1개로 축소): 메뉴 7(가용 2)에 서로 다른 order 8건 → 정확히 2건 `200`(서로 다른 Pod의 요청, holdId 162·163)·6건 `409 INSUFFICIENT_STOCK`·500 없음, 같은 order 8건 → 모두 `200`·같은 holdId 164·예약 한 행, 같은 확보(165)에 확정 3건·해제 3건 → 확정 `200`(멱등)·해제 `409 HOLD_NOT_ACTIVE`·최종 `CONFIRMED` 한 가지. 시험 뒤 메뉴 7 `2·0`, 메뉴 11은 복원(`200`)으로 `20·0` 원복. cp `available`은 확대 전 901MiB(기준 1Gi 미만)여서 시험을 5분 안에 끝내고 바로 축소함 | `conc2.py`(두 Pod 동시 요청 스크립트), `inventories`·`inventory_reservations` 조회 | 11/27 16:15 |

## 4. 관리자 API와 조회 (IN-01~IN-06)

| ID | 내용 | 상태 | 기대 결과 | 실제 결과 | 근거 | 일시 |
|---|---|---|---|---|---|---|
| I-14 | 권한·입력 검증 | PASS | 토큰 없음·위조 신원 헤더 `401`, CUSTOMER `403`, STORE_ADMIN `200`. 잘못된 본문 `400`, 없는 항목 `404 INVENTORY_NOT_FOUND`, 허용 안 한 메서드·`/internal` 외부 호출 `404` | 11/27 16:1x Gateway 경유(admin-demo·customer-demo 토큰): 토큰 없음 `401`, 토큰 없이 `X-User-Id`·`X-User-Role: STORE_ADMIN` 헤더만 위조 `401`, CUSTOMER 목록·등록 `403`(등록 안 됨), STORE_ADMIN 목록 `200`(항목 10개)·`lowStockOnly=true` 부족 항목 2개(메뉴 7·8), 잘못된 본문(`stockQty -1`)·조정 수량 0 `400 INVALID_REQUEST`, 없는 항목 조정 `404 INVENTORY_NOT_FOUND`, 외부에서 `/internal/v1/inventory/holds` 호출 `404` | curl(Gateway 경유) 응답 | 11/27 16:1x |
| I-15 | 등록·추가·연결·삭제 | PASS | IN-03 `201`, IN-04 재고 증가(1 이상만), IN-05 메뉴 연결(숨김 메뉴 `409 MENU_NOT_LINKABLE`, 이미 연결 `409 MENU_ALREADY_LINKED`, 진행 중 주문 `409 STOCK_ITEM_IN_USE`), IN-06 논리 삭제 후 IN-01·IN-02에서 제외 | 등록 `201`(`stockItemId 12`, 메뉴 미연결), 재고 추가 5 `200`(`stockQty 10→15`), 숨김 메뉴 연결 `409 MENU_NOT_LINKABLE`, 이미 연결된 메뉴 `409 MENU_ALREADY_LINKED`, 없는 메뉴 `404 MENU_NOT_FOUND`, `null` 연결 해제 `200`, 삭제 `200`, 삭제된 항목 추가·재삭제 `404 INVENTORY_NOT_FOUND`, 삭제 후 목록 항목 수 원복. 연결 성공 경로: 새 항목(13)을 `PAUSED` 메뉴 6에 연결 `200`(메뉴 6의 기존 항목 5를 먼저 해제), 항목 5 재연결 시도 `409 MENU_ALREADY_LINKED`, 해제 후 항목 5를 다시 연결해 복구, 새 항목 삭제. 확정 주문이 있는 메뉴 9의 연결 해제 `409 STOCK_ITEM_IN_USE`(연결 유지). 최종 상태: 항목 10개, 메뉴 6은 항목 5(재고 20)로 시험 전과 같음. 확정 주문이 있는 재고 항목의 삭제 거절은 데이터 보호를 위해 시험하지 않음 | curl(Gateway 경유) 응답, 목록 조회 | 11/27 16:1x |
| I-16 | 고객 재고 조회(IN-01) | PASS | `[{menuId, orderable, availableQty}]`, 미연결 메뉴는 `orderable:false`, `menuIds` 누락·0 이하·100개 초과 `400` | 토큰 없이 `GET /api/v1/inventory/availability?menuIds=3,7,8,11,999` → `200`, 메뉴 7 `orderable true`·가용 2, 메뉴 8 `false`·0(품절), 미연결 메뉴 999 `false`·0(오류 아님). `menuIds` 누락·0·숫자 아님 `400 INVALID_REQUEST`, 101개 `400`, 100개(경계) `200` | curl(Gateway 경유) 응답 | 11/27 16:2x |

## 5. 정합성·관측

| ID | 내용 | 상태 | 기대 결과 | 실제 결과 | 근거 | 일시 |
|---|---|---|---|---|---|---|
| I-17 | 재고 변동 이력(`inventory_histories`) | PASS(알려진 한계) | README는 `RESERVE`·`CONFIRM`·`RELEASE`·`RESTORE`·`RESTOCK`·`ADJUST` 이력을 기록한다고 설명하지만 main의 코드에는 이 테이블을 쓰는 곳이 없음(마이그레이션 V1에 테이블만 존재). 시험으로 행이 생기는지 확인해 사실로 기록한다. 요구사항·API 명세에 이력 기록·조회 요구는 없어 결함으로 올리지 않고 알려진 한계로 관리한다(팀장 이은제 11/27 15:40: 발표 전 추가 구현 불필요, 후속 Issue로 관리) | 11/27 16:0x 시험 전체(확보·확정·해제·복원·만료 수십 건) 뒤 `inventory_histories` 행 수 0: 이력을 기록하는 코드가 없다는 점을 사실로 확인. 요구사항·API 명세에 없는 기능이라 발표 전 구현하지 않고 알려진 한계로 관리(팀장 확인 11/27 15:40, 후속 Issue) | `inventory_histories` 행 수 조회 | 11/27 16:0x |
| I-18 | 지표·로그 | PASS(관찰) | `/actuator/prometheus`에 `application` 공통 라벨과 HTTP histogram(#430), ECS JSON 로그에 비밀·개인정보 없음 | 지표: `/actuator/prometheus`에 `application="inventory-service"` 라벨 줄 1,737개와 `http_server_requests_seconds_bucket`(HTTP histogram) 확인(#430 반영). 로그에 비밀번호·토큰·secret·authorization 검색 결과 0. 관찰: Inventory 로그는 전체 52줄이 모두 기동 로그이고 업무 로그가 없으며(오늘 수백 건 처리 후에도 한 시간 로그 0줄) 형식도 ECS JSON이 아닌 일반 텍스트(`docs/observability.md` 3절은 ECS JSON·`orderId` 키 로그를 제안, Menu·Auth Deployment에는 `LOGGING_STRUCTURED_FORMAT_CONSOLE=ecs`가 있으나 Inventory에는 없음). 12/1 CT-08에서 Inventory 흐름을 `orderId`로 추적하기 어려움 | `/actuator/prometheus`, `kubectl logs`(전체 줄 수 52), `docs/observability.md` | 11/27 16:0x |
| I-19 | DB 정합성 점검 | PASS | 시험 전체 뒤 모든 메뉴에서 `reserved_qty`가 `RESERVED` 예약 수량의 합과 같고, 시험 전 값으로 원복, `CONFIRMED` 예약 수량의 합이 `stock_qty` 변화와 일치 | 11/27 16:2x 시험 전체 뒤 `inventory_dev`: 모든 재고 항목(10개)에서 `reserved_qty`가 진행 중(`RESERVED`) 확보 수량 합과 같음(전부 0), 불변식(`stock_qty<0`·`reserved_qty<0`·`reserved_qty>stock_qty`) 위반 0건, 진행 중 확보 0건. 시험 대상 메뉴 7·10·11은 시험 전 값(`2`·`94`·`20`)으로 원복. 메뉴 9 `stock_qty 87`은 같은 날 Order 시험의 확정 주문 12건(99→87)과 계산이 맞음(작성자 계산) | `inventories`·`inventory_reservation_items`·`inventory_reservations` 조회 | 11/27 16:2x |

## 6. 관련 시험 참조(다른 문서)

- Menu 연동(재고 연결 시 메뉴 존재·숨김 확인, MI-02): 이 문서 I-15(`200`·`404 MENU_NOT_FOUND`·`409 MENU_NOT_LINKABLE`).
- 공동 테스트 범위: Inventory와 실제로 연동되는 서비스는 Order(확보·확정·해제·복원)와 Menu(메뉴 연결 확인)이며, Order 쪽은 `order-hpa.md` CT-05·O-04, Menu 쪽은 I-15에서 확인했다. Cooking·Payment는 Inventory를 호출하지 않는다. 작성자가 Order·Inventory를 함께 맡고 있어 별도 공동 확인 없이 결과를 공지하고 이의를 받는 방식으로 진행.
- 주문 취소 시 재고 복원(`RESTORED`)·조리 시작 후 거절 시 `CONFIRMED` 유지: `order-hpa.md`의 O-04·CT-05(11/27, 취소 성공 5건·거절 3건 DB 일치).
- 임시 주문 확보 TTL 해제(`reserved_qty 0`): `order-hpa.md` 기타 기록(11/27 12:50).
- Inventory 2 Pod·HPA(1→3→1): 11/25 시험(`DEV_186_PROGRESS.md`), CT-07 주관 김민규.

## 7. 알려진 사항·결함 후보

| 항목 | 내용 | 상태 |
|---|---|---|
| `inventory_histories` 이력 미기록 | ERD(3-7)·README는 재고 변동 이력 테이블을 설계·설명하지만(`RESERVE`·`CONFIRM`·`RELEASE`·`RESTORE`·`RESTOCK`·`ADJUST`) main에는 이 테이블에 쓰는 코드가 없고 어떤 API도 읽거나 쓰지 않는다. 요구사항·API 명세에는 포함되지 않은 기능이라 발표 전에는 구현하지 않고 별도 후속 Issue로 관리한다 | 알려진 한계(팀장 확인 11/27), 후속 Issue #461 |
| Inventory 로그 형식·업무 로그 없음 | dev 로그가 일반 텍스트이고 업무 로그가 없음(I-18). `docs/observability.md` 3절 제안(ECS JSON, `orderId` 키 로그)과 다름. 발표 전 필수 여부를 팀장에게 확인 요청 | 확인 대기 |

## 8. 기타 기록

(시험 중 관찰한 것을 이 절에 추가한다.)

- 11/27 15:52 확보 143(order 920010)·144(order 920011)가 만료되기 전에 확정을 보내 `200`(확정)·해제 `409`가 나왔다. 정상 확정·해제 경로 재확인이며 만료 시험은 I-06~I-08에서 새 확보로 수행. 확정된 두 건은 복원(`200`)해 재고를 원복했다.
