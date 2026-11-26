# Payment·클러스터 통합 테스트 — 정진혁

- 담당: Payment Service, dev·prod Kubernetes 클러스터, Payment 배포·운영 설정
- 공동 테스트 주관: CT-04 결제 실패·중복·응답 유실
- 상태 값: NOT RUN / IN PROGRESS / PASS / FAIL / BLOCKED / RETEST

## 테스트 환경

| 항목 | 값 |
|---|---|
| 환경 | dev (`https://peakorder-dev.jpexstudio.com`) |
| Payment 이미지 | `sha-5675838fe251862e7ffc4b4c7edb9503bf12faa5` (11/26 기준) |
| Payment 설정 | Hikari 4/1, preStop 10초·종료 유예 50초 (#363), HPA min 1·max 3·CPU 70% (#374) |
| 테스트 계정 | customer-demo (비밀번호는 기록하지 않음) |
| 테스트 데이터 | paymentId 9018(환불됨), 9019, 9020(주문 261126-0001), 9021(주문 261126-0002, 취소·환불됨), 9022(주문 11번, FAILED) / orderId 999001, 999002 (가짜 주문번호) |

## 1. Payment Service

| ID | 내용 | 상태 | 실제 결과 | 근거 | 일시 |
|---|---|---|---|---|---|
| P-01 | 결제 승인(SUCCESS) 응답 | PASS | paymentId 9018, `SUCCESS` | port-forward 후 `POST /internal/v1/payments` | 11/26 10:53 |
| P-02 | 같은 idempotencyKey 재전송 시 결제 1건 | PASS | 3번 보내도 같은 paymentId 9018 | 같은 요청 반복 | 11/26 10:54 |
| P-03 | 환불: 승인 결제 환불, 재환불, 없는 결제 | PASS | `REFUNDED` → 다시 `REFUNDED`(중복 환불 없음) → 999999는 `PAYMENT_NOT_FOUND` | `POST /internal/v1/payments/{id}/refund` | 11/26 11:22 |
| P-03b | 승인 안 된(FAILED) 결제 환불 → 409 | PASS | paymentId 9022(FAILED) 환불 요청 → 409 `PAYMENT_NOT_REFUNDABLE` | port-forward 후 `POST /internal/v1/payments/9022/refund` | 11/26 15:11 |
| P-04 | Mock 실패 전환 후 주문 흐름 | PASS | 15:08 FAIL 전환 → 화면 주문 11번 결제 402 `PAYMENT_FAILED`, "모의 결제가 거절됐어요" 표시, Payment 로그 `orderId=11 paymentId=9022 status=FAILED` → 15:13 복원(env 삭제, APPROVE) | `kubectl set env ... PAYMENT_MOCK_RESULT=FAIL`, 디스코드 공지 후 진행 | 11/26 15:09 |
| P-05 | 내부 API 외부 접근 차단 | PASS | dev 도메인 `/internal/v1/payments/9018` → 404 | 내 PC에서 `curl.exe` | 11/26 11:25 |

## 2. 클러스터 및 배포

| ID | 내용 | 상태 | 실제 결과 | 근거 | 일시 |
|---|---|---|---|---|---|
| I-01 | 노드·Pod·Argo CD 상태 | PASS | 노드 3개 Ready, 비정상 Pod 없음, 앱 9개 Synced/Healthy | `kubectl get nodes`, `get pods -A`, `get applications -n argocd` | 11/26 10:52 |
| I-02 | 외부 도메인 → Gateway → 서비스 | PASS | dev 홈 화면 정상, `/api/v1/menus` 200 | 브라우저 접속 | 11/26 11:06 |
| I-03 | Payment ↔ PostgreSQL 연결 | PASS | actuator health `UP` | `kubectl exec ... /actuator/health` | 11/26 10:52 |
| I-04 | Payment Pod 삭제 → 자동 복구 | PASS | 새 Pod 약 21초 만에 1/1 Running, 이후 paymentId 9019 `SUCCESS` | `kubectl delete pod`, `get pods -w` | 11/26 11:43 |
| I-05 | Payment DB 연결 풀(최대 4·최소 1) 및 연결 수 | IN PROGRESS | Pod 환경 변수 `MAXIMUM_POOL_SIZE=4`, `MINIMUM_IDLE=1` 확인. DB 쪽 연결 수는 미확인 | `kubectl exec ... env` | 11/26 09:53 |

## 3. 서비스 간 연동

| ID | 내용 | 상태 | 실제 결과 | 근거 | 일시 |
|---|---|---|---|---|---|
| C-01 | Order → Payment 결제 요청·결과 | PASS | 화면 주문 261126-0001(31,900원) → Payment 로그 `orderId=9 paymentId=9020 status=APPROVED`, 이후 조리 중으로 전환 | customer-demo로 화면 주문, `kubectl logs deploy/payment-service` | 11/26 14:29 |
| C-02 | 주문 취소 → Payment 환불 | PASS | 주문 261126-0002(18,700원) 조리 대기 중 취소 → Payment 로그 14:41:36 `결제 처리 orderId=10 paymentId=9021 APPROVED`, 14:41:51 `환불 완료 orderId=10 paymentId=9021` | 다른 주문 조리 중일 때 주문해 대기 상태에서 화면 취소, `kubectl logs deploy/payment-service` | 11/26 14:41 |
| C-03 | 결제 실패 시 조리로 넘어가지 않음 | PASS | 주문 11번 결제 실패 후 조리 단계로 안 넘어감, 고객 주문 내역 목록에도 표시 안 됨(실패 주문 상태값은 Order 담당 확인 예정) | 화면 주문 내역 | 11/26 15:12 |

## 4. 공동 테스트 (주관)

| ID | 내용 | 상태 | 비고 |
|---|---|---|---|
| CT-04 | 결제 실패·중복·응답 유실 | NOT RUN | Order 담당(주문 상태), Frontend(F-04)와 함께 진행. P-02·P-04 결과를 바탕으로 함. 11/27 진행 예정 |

## 5. 기타 확인 기록

- 11/26 HPA(#374) 병합 직후 기동 CPU로 1 → 3 확대, w1·w2에 분산 배치, 약 11분 뒤 1로 축소 (#362 댓글)
- 11/26 dev 로그인 403: Auth `allowed-origins`에 dev 도메인이 없어서였음 → Auth 담당이 해결
- 11/26 11:43 I-04 Pod 삭제는 주문 접수가 꺼진 상태라 다른 테스트 영향 없음
- 11/26 Payment 공통 지표 설정 누락 발견 → #393 / PR #397
- 11/26 14:19 Order 영업·접수 켜짐(#399, Order 담당 공지) → C-01 BLOCKED 해제
- 화면: 주문 내역 목록은 조리 중일 때 "결제 완료"로 보이다가 완료되면 "완료"로 바뀜 → "조리 중" 단계가 목록에 표시되지 않음, Frontend 담당 공유 예정
- 조리 대기가 0건이면 결제 즉시 조리가 시작돼 취소 불가 → C-02는 다른 주문이 조리 중일 때 진행
- 11/26 15:08~15:13 Payment 결제 실패 모드 전환(디스코드 공지 후 진행, 종료 후 복원 공지) — 이 시간 Payment Pod 교체 2회는 이 작업 때문

## 관련 이슈·PR

- #362, #363, #374 (Payment 연결 풀·종료 보호·HPA)
- #393, #397 (Payment 공통 지표)
- #399 (Order 관리자 API dev 공개 — C-01 선행 조건)