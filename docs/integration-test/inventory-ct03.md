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
| Inventory 이미지 | 시험 직전 `kubectl`로 확인해 기록(dev 매니페스트 기준 `sha-f4201cc…`) |
| Inventory 설정 | `STOCK_HOLD_TTL` 5분, 만료 스케줄러 5초 간격, Hikari 4/1, HPA min 1·max 3·CPU 70%, 관리자 API dev 공개(#337) |
| 내부 API 호출 | `/internal/v1/...`는 Gateway로 노출되지 않아 Pod에 `kubectl port-forward`로 직접 호출(2 Pod 시험은 Pod별 포트 포워딩) |
| 관리자 API 호출 | Gateway 경유, admin-demo(STORE_ADMIN)·customer-demo(CUSTOMER) 토큰 (비밀번호는 기록하지 않음) |
| 시험용 데이터 | 시험 order_id는 920001~929999(다른 시험의 910001~919099, 999001·999002와 겹치지 않음). 메뉴 7(프렌치프라이, 가용 3)·메뉴 11(바닐라 아이스크림, 가용 20)을 임시로 사용하고 시험 뒤 `reserved_qty`를 시험 전 값으로 되돌린 것을 확인한다 |
| 공유 설정 변경 | 없음(TTL·영업 상태 변경 없음). 시험 전 Discord 공지 |

시험 전후에 기록할 값: `inventories`의 메뉴 7·11 `stock_qty`·`reserved_qty`, `inventory_reservations`의 시험 order_id별 상태.

## 1. 재고 확보·확정·해제·복원 (II-01~II-04)

| ID | 내용 | 상태 | 기대 결과 | 실제 결과 | 근거 | 일시 |
|---|---|---|---|---|---|---|
| I-01 | 확보(II-01) 정상·멱등·거절 | NOT RUN | 정상 `200 {holdId, expiresAt}`과 `reserved_qty` 증가·예약 `RESERVED`. 같은 `orderId` 재호출은 기존 확보 반환(`reserved_qty` 한 번만 증가). 재고보다 많은 수량 `409 INSUFFICIENT_STOCK`, 재고 미연결 메뉴 `409 STOCK_NOT_LINKED`, 잘못된 본문 `400 INVALID_REQUEST`. 같은 메뉴를 한 주문에 두 번 담으면 합산 | | | |
| I-02 | 확정(II-02) 정상·멱등·거절 | NOT RUN | 정상 `200`, `stock_qty`·`reserved_qty` 함께 차감·예약 `CONFIRMED`. 재호출 `200`(변화 없음). 해제·만료된 확보 `409 HOLD_NOT_ACTIVE`, 없는 holdId `404 HOLD_NOT_FOUND` | | | |
| I-03 | 해제(II-03) 정상·멱등·거절 | NOT RUN | 정상 `200`, `reserved_qty`만 차감·`RELEASED`. 재호출 `200`. 이미 `EXPIRED`도 `200`. 확정된 확보 `409 HOLD_NOT_ACTIVE`, 없는 holdId `404` | | | |
| I-04 | 복원(II-04) 정상·멱등·거절 | NOT RUN | 확정된 확보 `200 {restored:true}`, `stock_qty`만 증가·`RESTORED`. 재호출 `200`. 확정되지 않은 확보·없는 주문 `409 RESTORE_NOT_APPLICABLE`. 주문 연동 경로는 CT-05(Order 쪽)에서 확인 | | | |
| I-05 | 이미 해제된 orderId로 재확보(경계 관찰) | NOT RUN | 코드상 같은 `orderId`의 기존 확보를 상태와 무관하게 반환한다(해제된 확보를 `200`으로 돌려줄 수 있음). Order는 orderId를 재사용하지 않으므로 업무 영향은 없는지 확인해 기록(결함이 아닌 관찰) | | | |

## 2. TTL·만료 (II-01 만료, HoldExpiryScheduler)

| ID | 내용 | 상태 | 기대 결과 | 실제 결과 | 근거 | 일시 |
|---|---|---|---|---|---|---|
| I-06 | TTL 만료 | NOT RUN | 확보 5분 뒤 스케줄러(5초 간격)가 예약을 `EXPIRED`로 바꾸고 `reserved_qty`를 되돌림. 11/27 12:50 Order 시험에서 Inventory `reserved_qty 0` 복귀는 확인했고, 여기서는 예약 상태·시각을 직접 기록 | | | |
| I-07 | 만료 뒤 확정·해제 | NOT RUN | `expiresAt`이 지난 확보의 확정은 스케줄러가 처리하기 전에도 `409 HOLD_NOT_ACTIVE`(코드의 `isExpired` 검사). 만료 후 해제는 `200`(멱등) | | | |
| I-08 | 만료 경계 경쟁(확정 vs 스케줄러) | NOT RUN | `expiresAt` −0.3~+0.3초에 확정을 보내면 한쪽만 이긴다. 확정 성공이면 `CONFIRMED`·`stock_qty` 차감, 거절이면 `EXPIRED`·`reserved_qty` 복귀이고 두 결과가 섞이지 않음 | | | |

## 3. 동시성

| ID | 내용 | 상태 | 기대 결과 | 실제 결과 | 근거 | 일시 |
|---|---|---|---|---|---|---|
| I-09 | 같은 메뉴 동시 확보(초과 판매 방지) | NOT RUN | 메뉴 7(가용 3)에 서로 다른 order_id 8건을 동시에 확보 요청 → 정확히 3건 `200`, 5건 `409 INSUFFICIENT_STOCK`, `reserved_qty 3`(가용 0). 이후 전부 해제해 원복 | | | |
| I-10 | 같은 orderId 동시 확보 | NOT RUN | 같은 orderId 8건 동시 → 모두 같은 holdId, 예약 1행, `reserved_qty` 한 번만 증가(500 없음) | | | |
| I-11 | 같은 확보에 확정·해제 경쟁 | NOT RUN | 확정과 해제를 동시에 → 한쪽만 성공하고 반대쪽은 `409 HOLD_NOT_ACTIVE`(또는 멱등 `200`), 최종 상태가 한 가지(`CONFIRMED` 또는 `RELEASED`)이고 `stock_qty`·`reserved_qty`와 일치 | | | |
| I-12 | 여러 메뉴 동시 확보(교착 방지) | NOT RUN | 두 메뉴를 서로 반대 순서로 담은 요청을 동시에 → 교착·타임아웃 없이 완료(코드는 메뉴 ID 순서로 잠금) | | | |
| I-13 | 2 Pod 동시 확보·확정 | NOT RUN | Pod별 포트 포워딩으로 같은 메뉴를 두 Pod에서 동시에 확보·확정 → I-09와 같은 결과. 11/25에 2 Pod PASS(HPA 시험)이며 최신 이미지로 재확인 | | | |

## 4. 관리자 API와 조회 (IN-01~IN-06)

| ID | 내용 | 상태 | 기대 결과 | 실제 결과 | 근거 | 일시 |
|---|---|---|---|---|---|---|
| I-14 | 권한·입력 검증 | NOT RUN | 토큰 없음·위조 신원 헤더 `401`, CUSTOMER `403`, STORE_ADMIN `200`. 잘못된 본문 `400`, 없는 항목 `404 INVENTORY_NOT_FOUND`, 허용 안 한 메서드·`/internal` 외부 호출 `404` | | | |
| I-15 | 등록·추가·연결·삭제 | NOT RUN | IN-03 `201`, IN-04 재고 증가(1 이상만), IN-05 메뉴 연결(숨김 메뉴 `409 MENU_NOT_LINKABLE`, 이미 연결 `409 MENU_ALREADY_LINKED`, 진행 중 주문 `409 STOCK_ITEM_IN_USE`), IN-06 논리 삭제 후 IN-01·IN-02에서 제외 | | | |
| I-16 | 고객 재고 조회(IN-01) | NOT RUN | `[{menuId, orderable, availableQty}]`, 미연결 메뉴는 `orderable:false`, `menuIds` 누락·0 이하·100개 초과 `400` | | | |

## 5. 정합성·관측

| ID | 내용 | 상태 | 기대 결과 | 실제 결과 | 근거 | 일시 |
|---|---|---|---|---|---|---|
| I-17 | 재고 변동 이력(`inventory_histories`) | NOT RUN | README는 `RESERVE`·`CONFIRM`·`RELEASE`·`RESTORE`·`RESTOCK`·`ADJUST` 이력을 기록한다고 설명하지만 main의 코드에는 이 테이블을 쓰는 곳이 없음(마이그레이션 V1에 테이블만 존재). 시험으로 행이 생기는지 확인하고, 명세(ERD·API)가 이력 기록을 요구하는지 확인한 뒤 결함 Issue로 올릴지 결정 | | | |
| I-18 | 지표·로그 | NOT RUN | `/actuator/prometheus`에 `application` 공통 라벨과 HTTP histogram(#430), ECS JSON 로그에 비밀·개인정보 없음 | | | |
| I-19 | DB 정합성 점검 | NOT RUN | 시험 전체 뒤 모든 메뉴에서 `reserved_qty`가 `RESERVED` 예약 수량의 합과 같고, 시험 전 값으로 원복, `CONFIRMED` 예약 수량의 합이 `stock_qty` 변화와 일치 | | | |

## 6. 관련 시험 참조(다른 문서)

- 주문 취소 시 재고 복원(`RESTORED`)·조리 시작 후 거절 시 `CONFIRMED` 유지: `order-hpa.md`의 O-04·CT-05(11/27, 취소 성공 5건·거절 3건 DB 일치).
- 임시 주문 확보 TTL 해제(`reserved_qty 0`): `order-hpa.md` 기타 기록(11/27 12:50).
- Inventory 2 Pod·HPA(1→3→1): 11/25 시험(`DEV_186_PROGRESS.md`), CT-07 주관 김민규.

## 7. 알려진 사항·결함 후보

| 항목 | 내용 | 상태 |
|---|---|---|
| `inventory_histories` 미기록 | 테이블만 있고 기록 코드가 없음(I-17 참조) | 확인 필요 |

## 8. 기타 기록

(시험 중 관찰한 것을 이 절에 추가한다.)
