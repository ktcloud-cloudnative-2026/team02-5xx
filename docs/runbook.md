# 런북

[← README](../README.md)

> 시작용 예시입니다. 팀에서 정한 내용으로 고치거나, 필요 없으면 지워도 됩니다.
>
> 외부 도구로 써도 됩니다(추천: [Notion](https://www.notion.so)). 그 경우 이 파일에는 링크와 한 줄 요약만 남깁니다.

장애가 났을 때 처음 보는 팀원도 그대로 따라 할 수 있게 씁니다. 해결한 [트러블슈팅 이슈](../../../issues?q=label%3Abug) 중 반복될 것을 여기로 옮깁니다.

## 공통 확인 순서

알림이 울리거나 서비스가 이상할 때 이 순서로 본다. dev 명령은 `t2-dev-cp`에 SSH로 접속해 그 노드의 `kubectl`로 실행한다. **prod에는 직접 아무것도 바꾸지 않는다**(CLAUDE.md 8절).

```bash
# 0. 어디에 접속했는지 먼저 (dev 노드는 10.10.22.11~13)
hostname && kubectl config current-context && kubectl get nodes -o wide

# 1. Pod 상태: STATUS·RESTARTS·AGE
kubectl -n peakorder get pods -o wide

# 2. 이상한 Pod의 Events (맨 아래가 최근)
kubectl -n peakorder describe pod <파드> | tail -25

# 3. 로그: 최근 경고·오류 / 직전에 죽은 컨테이너 로그 (서비스 로그 형식에 맞는 줄을 쓴다)
kubectl -n peakorder logs deploy/<서비스> --since=15m | grep -E '"level":"(WARN|ERROR)"' | tail -20   # ECS JSON 로그
kubectl -n peakorder logs deploy/<서비스> --since=15m | grep -E ' (WARN|ERROR) ' | tail -20          # 텍스트 로그
kubectl -n peakorder logs <파드> --previous | tail -50

# 4. 최근 배포: Argo CD 상태와 반영된 Git 커밋
kubectl get application -n argocd
kubectl get application <서비스>-dev -n argocd -o jsonpath='{.status.sync.status} {.status.health.status} {.status.sync.revision}{"\n"}'
git log --oneline -5 origin/main -- deploy/apps/<서비스>   # 내 PC 저장소에서

# 5. 의존 대상
kubectl -n peakorder exec rabbitmq-0 -- rabbitmqctl ping
kubectl -n peakorder exec rabbitmq-0 -- rabbitmqctl list_queues name messages consumers
```

- **로그 형식은 서비스마다 다르다.** ECS JSON(한 줄에 JSON 하나): **Cooking**(#190), **Order**(#271). 그 외 서비스는 ECS 적용 전이라 Spring 기본 텍스트 로그다. ECS가 적용되면 이 줄을 갱신한다. JSON용 명령은 텍스트 로그에서 아무것도 찾지 못하므로 형식에 맞는 명령을 쓴다.
- 시각은 **UTC**라 한국 시간은 +9시간이다(ECS의 `@timestamp`).
- `consumers`가 0인 업무 큐는 받는 서비스가 연결돼 있지 않다는 뜻이다(메시지가 쌓인다).
- DB 접속 문제는 아래 [PostgreSQL](#postgresql-t2-db) 절의 "접속이 안 될 때"를 본다.
- Secret은 `-o yaml`로 출력하지 않는다. 결과를 채팅·이슈에 붙일 때 비밀값이 섞이지 않았는지 확인한다.

| 본 것 | 다음 |
|---|---|
| `CrashLoopBackOff`, RESTARTS가 계속 늘어남 | [CrashLoopBackOff](#crashloopbackoff) |
| `*.dlq` 큐의 `messages`가 0보다 큼 | [DLQ](#dlq) |
| 로그에 `이벤트 발행 실패`가 반복 | [Outbox](#outbox) |
| 최근 배포 직후부터 이상 | 아래 각 절의 "되돌리기" |

## 장애별 대응

`docs/observability.md` 4-2절 알림의 대응 문서다. 알림 규칙의 링크가 깨지지 않도록 **절 제목을 바꾸지 않는다**.

| 알림 (4-2절) | 절 |
|---|---|
| 1 DLQ 메시지 | [DLQ](#dlq) |
| 2 `up == 0`, 3 5xx 비율, 7 Pod 없음 | [공통 확인 순서](#공통-확인-순서) |
| 4 재시작 반복 | [CrashLoopBackOff](#crashloopbackoff) |
| 5 Outbox 대기 | [Outbox](#outbox) |

### CrashLoopBackOff

컨테이너가 시작하자마자 죽고, Kubernetes가 간격을 늘려 가며 다시 띄우는 상태다.

```bash
kubectl -n peakorder get pods
kubectl -n peakorder get pod <파드> -o jsonpath='{.status.containerStatuses[0].lastState.terminated.reason} {.status.containerStatuses[0].lastState.terminated.exitCode}{"\n"}'
kubectl -n peakorder logs <파드> --previous | tail -50
kubectl -n peakorder describe pod <파드> | tail -25
```

| 보이는 것 | 흔한 원인 | 조치 |
|---|---|---|
| `OOMKilled`, 종료 코드 137 | 메모리 제한(limits) 초과 | 자원 값 또는 `JAVA_TOOL_OPTIONS`(`-XX:MaxRAMPercentage`)을 고치는 PR |
| 로그에 `password authentication failed`, `fe_sendauth` | DB Secret 값·키 문제 | Secret 키 확인(`kubectl -n peakorder get secret <서비스>-db` → DATA 수), [PostgreSQL](#postgresql-t2-db) 접속 표 |
| `RABBITMQ_PORT`에 `tcp://…`가 들어가 숫자 변환 오류 | Service 이름 `rabbitmq`로 자동 주입된 환경 변수와 충돌 | Deployment에 `enableServiceLinks: false` + `RABBITMQ_PORT: "5672"` (#161) |
| Flyway `Validate failed`, `checksum mismatch` | 이미 적용된 마이그레이션 파일이 바뀜 | 적용된 `V*.sql`은 고치지 않고 새 버전 파일로 바꾼다. DB 담당과 확인 |
| Events에 `Startup probe failed`가 반복 | 기동이 제한 시간 안에 끝나지 않음(Cooking은 최대 2분) | 로그에서 멈춘 지점(DB·RabbitMQ 연결 등) 확인 |
| 상태가 `CreateContainerConfigError` (CrashLoopBackOff 전) | 참조한 Secret이나 키가 없음 | `kubectl -n peakorder get secret <이름>`으로 존재·DATA 수 확인 |
| 상태가 `ImagePullBackOff` | 이미지 태그 오타, GHCR 접근 | overlay의 이미지 태그·GHCR 게시 확인 |

- 배포 교체 중 **이전 Pod**가 `Terminating` 뒤 `Error`로 보이는 것은 종료 신호로 내려가며 0이 아닌 코드로 끝난 것으로, 새 Pod가 `1/1`이면 장애가 아니다(#190에서 확인).

**되돌리기**: 원인이 최근 배포라면 **Git에서 되돌리는 PR**(이전 이미지 태그·설정으로)을 올려 병합하고 Argo CD에서 Sync한다. `kubectl edit`·`apply`로 직접 고치지 않는다(Git과 달라지고 다음 Sync에서 덮어써진다). dev에서 급히 Argo CD 화면의 이전 버전 Sync(History and Rollback)가 필요하면 Argo CD 담당과 먼저 상의한다.

### DLQ

처리하지 못한 이벤트가 DLQ(Dead Letter Queue)에 들어갔다. 받는 쪽이 메시지를 거절하면 RabbitMQ가 DLX(`peakorder.dlx`)를 거쳐 `<업무 큐>.dlq`로 옮긴다.

| DLQ | 무엇이 실패했나 | 담당 |
|---|---|---|
| `cooking.order-confirmed.dlq` | Cooking이 OrderConfirmed(EV-01)를 처리하지 못함 → 조리 전표가 안 생김 | Cooking |
| `order.cooking-completed.dlq` | Order가 CookingCompleted(EV-02)를 처리하지 못함 → 주문이 완료로 안 바뀜 | Order |

**언제 DLQ로 가나** ([이벤트 명세](events/notion-draft.md) "발행·재시도·DLQ")
- 형식 오류·필수값 누락·잘못된 값·존재하지 않는 주문·처리할 수 없는 상태: 재시도 없이 바로
- DB 연결 같은 일시적 오류: 첫 시도 포함 3번(1초·2초 간격) 실패한 뒤

**확인**
```bash
kubectl -n peakorder exec rabbitmq-0 -- rabbitmqctl list_queues name messages consumers | grep -E 'dlq'
kubectl -n peakorder logs deploy/<받는 서비스> --since=30m | grep -E '"level":"(WARN|ERROR)"' | tail -20   # ECS JSON 로그(Cooking·Order)
kubectl -n peakorder logs deploy/<받는 서비스> --since=30m | grep -E ' (WARN|ERROR) ' | tail -20          # 텍스트 로그(그 외)
```

**메시지 내용 확인** — 확인할 것은 본문의 `eventId`·`orderId`와 헤더 `x-death`(거절 이유·원래 큐·횟수·시각)다.

RabbitMQ Pod 안의 `rabbitmqadmin`(v2)을 쓴다. 계정은 Pod 안 환경 변수로 넘겨 **비밀번호를 출력하거나 셸 기록에 남기지 않는다.**
```bash
RA='RABBITMQADMIN_USERNAME="$RABBITMQ_DEFAULT_USER" RABBITMQADMIN_PASSWORD="$RABBITMQ_DEFAULT_PASS" rabbitmqadmin'
kubectl -n peakorder exec rabbitmq-0 -- sh -c "$RA queues list"     # 큐별 메시지 수·소비자 수
Q=cooking.order-confirmed.dlq     # 알림의 queue 라벨에 맞춘다: cooking.order-confirmed.dlq 또는 order.cooking-completed.dlq
kubectl -n peakorder exec rabbitmq-0 -- sh -c "$RA get messages --queue $Q --count 5 --ack-mode ack_requeue_true"
```
- 어느 DLQ인지는 알림 `RabbitMQDeadLetterQueueNotEmpty`의 `queue` 라벨이나 위 `queues list`의 메시지 수로 정한다(위 표: Cooking 실패 / Order 실패).
- ⚠️ **`get messages`는 반드시 `--ack-mode ack_requeue_true`로 실행한다.** 기본값(`ack_requeue_false`)은 꺼낸 메시지를 **큐에서 지운다.** 지운 DLQ 메시지는 되돌릴 수 없다.
- 출력 열: `payload`(본문 — `eventId`·`orderId`), `properties`(헤더 — `x-death`), `redelivered`, `exchange`, `routing_key`, `message_count`(꺼낸 뒤 남은 수). `ack_requeue_true`로 본 메시지는 큐에 다시 들어가며 `redelivered`가 `true`로 바뀌거나 순서가 바뀔 수 있다(DLQ에서는 문제없다).
- 명령 형식은 2026-11-25 dev에서 빈 DLQ로 확인했다(#336). **메시지가 있을 때 `x-death`가 `properties`에 어떻게 보이는지는 아직 확인하지 않았다.**
- 위 로그(받는 서비스의 WARN·ERROR)로도 실패한 `eventId`·`orderId`와 이유를 찾을 수 있다.

**관리 화면(15672)**: 계정은 `rabbitmq-secret`의 `username`(dev는 `peakorder`, `administrator` 권한)이다. Secret 값은 **base64를 풀어서** 입력한다(`kubectl -n peakorder get secret rabbitmq-secret -o jsonpath='{.data.username}' | base64 -d`; 비밀번호도 같은 방법으로 보되 채팅·이슈에 붙이지 않는다). 2026-11-23의 `Not authorized`는 계정·권한 문제가 아니었다 — 같은 계정으로 관리 API(`rabbitmqadmin show overview`) 로그인이 되는 것을 2026-11-25에 확인했다(#336). 화면은 port-forward로만 보고, 공용 cp에서 이미 쓰이는 포트(3000·18082 등)와 겹치지 않는 번호를 쓴다.

| 원인 | 조치 |
|---|---|
| 보낸 쪽 형식·값 오류(필수값 누락 등) | 보낸 서비스 담당에게 `eventId`·본문을 공유하고 코드 수정 |
| 존재하지 않는 주문, 처리할 수 없는 상태 | Order 담당과 주문 상태 확인 |
| 일시적 오류(재시도 소진) | 원인(DB·네트워크)을 먼저 해결 |

**재처리는 아직 정하지 않았다(미정).** 팀 합의 전에는 DLQ 메시지를 지우거나(purge) 업무 큐에 다시 넣지 않는다([이벤트 명세](events/notion-draft.md): 임의로 재주입하거나 새 `eventId`로 바꾸지 않음). 이슈를 만들어 `eventId`·`orderId`·`x-death`·원인을 기록하고 담당자와 처리 방법을 정한다.
- 참고: 받는 쪽은 `eventId`로 중복을 막는다(`processed_events`, Cooking은 `cooking_tickets.order_id` UNIQUE도). 같은 메시지가 다시 들어와도 두 번 처리되지 않지만, 재주입 방법과 주체는 합의 후 이 절에 추가한다.
- 업무 큐의 dead-letter 설정(`x-dead-letter-*`)은 큐를 처음 만들 때 정해진다. 바꾸려면 큐를 지우고 다시 만들어야 하므로 큐 설정을 임의로 바꾸지 않는다.

### Outbox

서비스는 보낼 이벤트를 먼저 DB의 `outbox_events`에 `PENDING`으로 저장하고, 1초마다 RabbitMQ로 발행한 뒤 `SENT`로 바꾼다(Cooking·Order 같은 구조, #52). `PENDING`이 쌓이면 발행이 막힌 것이다.
- 발행에 실패한 이벤트에서 그 주기를 멈추고 뒤의 이벤트도 보내지 않는다(순서 유지). 그래서 **하나가 막히면 뒤의 이벤트가 모두 쌓인다.**
- 성공 판정은 브로커 확인(publisher confirm)을 받고, 라우팅할 큐가 없어 되돌아오지(return) 않았을 때만이다.

**확인**
```bash
kubectl -n peakorder logs deploy/<서비스> --since=15m | grep -A3 '이벤트 발행 실패' | tail -20

# t2-db에서 (읽기만)
sudo -u postgres psql -d cooking_dev -c "SELECT event_type, count(*), min(created_at) FROM outbox_events WHERE status = 'PENDING' GROUP BY event_type;"
# Order는 -d order_dev
```

원인 메시지(아래 표)가 찍히는 위치는 로그 형식에 따라 다르다. 그래서 위 명령은 `-A3`으로 다음 줄까지 본다.
- Cooking: `이벤트 발행 실패 …` 같은 줄 끝에 원인 메시지가 붙는다.
- ECS JSON 로그에서 예외를 함께 남기는 경우(Order, #271): 같은 줄의 `error.message`(원인)·`error.type`·`error.stack_trace` 필드에 들어간다(로컬 실행으로 확인했고 dev 로그는 병합 후 확인한다).
- 텍스트 로그(ECS 적용 전 서비스): 원인이 다음 줄의 예외 메시지에 있다.

| 로그 메시지 (Cooking·Order 같음) | 원인 | 조치 |
|---|---|---|
| `라우팅할 큐가 없어 메시지가 반환되었습니다(바인딩 필요)` | 받는 쪽 큐가 아직 없음(받는 서비스가 안 떴거나 큐 선언 전) | 받는 서비스 Pod와 `list_queues`로 큐 확인. 큐가 생기면 자동으로 발행된다. 받는 서비스가 나중에 배포되는 동안은 정상(#162 README) |
| `발행 확인을 받지 못했습니다`, 연결 오류 | RabbitMQ 연결 문제 | `rabbitmq-0` 상태·`rabbitmqctl ping`, 5672 허용(NetworkPolicy #166) |
| `브로커가 메시지를 거부했습니다` | 브로커가 거부(nack) | `kubectl -n peakorder logs rabbitmq-0` |

- 원인을 해결하면 다음 주기(1초)에 자동으로 발행된다.
- **`status`를 직접 `SENT`로 바꾸거나 행을 지우지 않는다.** 이벤트가 사라져 주문이 완료되지 않거나 전표가 생기지 않는다.
- 알림 5번 지표(`cooking_outbox_pending` 등)는 아직 구현 전이다. 그 전까지는 위 SQL과 로그로 확인한다.

## PostgreSQL (t2-db)

### 구성

| 항목 | 값 |
|---|---|
| 서버 | t2-db `10.10.22.10` (Ubuntu 24.04, 강사 제공 VM) |
| 버전 | PostgreSQL 16 (Ubuntu 기본 패키지) |
| 포트 | 5432 |
| DB | `서비스_환경` 12개 (예: `inventory_dev`, `inventory_prod`) |
| 계정 | `서비스_환경_user` 12개 (예: `inventory_dev_user`). 계정마다 자기 DB만 접속 가능 |
| 접속 허용 | dev DB는 dev 노드(.11~.13)에서만, prod DB는 prod 노드(.21~.23)에서만 (`pg_hba.conf`) |
| 비밀번호 | 문서·Git·채팅에 기록하지 않음. 서비스는 Secret `<서비스>-service-db`의 `DB_URL`·`DB_USER`·`DB_PASSWORD` 키로 받음(Order·Payment·Cooking과 같은 형식. Menu는 `menu-service-db`에 `MENU_DB_*` 키를 쓰는 예외). dev Secret은 비밀번호를 관리하는 DB 담당이 `peakorder` 네임스페이스에 직접 만들고, 이슈에는 이름·키 존재만 남김(#112, 2026-11-23 합의). prod Secret 생성 방식·담당은 [미정: GitOps 담당과 결정] |
| 백업 | 매일 03:00 `pg_dump`, `/var/backups/postgresql/peakorder`, 7일 보관 |

서비스: auth, menu, inventory, order, payment, cooking

### 설치 기록 (2026-11-13, 남규리)

```bash
# 1. 설치
sudo apt update
sudo apt install -y postgresql

# 2. 계정·DB 12개 (비밀번호는 \password로 따로 입력)
for s in auth menu inventory order payment cooking; do
  for e in dev prod; do
    sudo -u postgres psql -v ON_ERROR_STOP=1 \
      -c "CREATE ROLE ${s}_${e}_user WITH LOGIN;" \
      -c "CREATE DATABASE ${s}_${e} OWNER ${s}_${e}_user;" \
      -c "REVOKE CONNECT ON DATABASE ${s}_${e} FROM PUBLIC;"
  done
done

# 3. 바깥 주소에서 접속 받기 (재시작 필요)
sudo -u postgres psql -c "ALTER SYSTEM SET listen_addresses = 'localhost,10.10.22.10';"

# 4. 출입 명단: /etc/postgresql/16/main/pg_hba.conf 끝에 추가 (원본은 pg_hba.conf.bak)
# host  <dev DB 6개>   all  10.10.22.11/32 ~ .13/32  scram-sha-256
# host  <prod DB 6개>  all  10.10.22.21/32 ~ .23/32  scram-sha-256
sudo systemctl restart postgresql
```

- dev 파드 → dev DB: 비밀번호 요청까지 도달 확인
- dev 파드 → prod DB: `no pg_hba.conf entry`로 차단 확인 (DB가 본 주소는 노드 IP)
- prod 노드 → 5432 포트 연결 확인 (prod에는 시험용 파드를 만들지 않음)

**설정 점검 기록 (2026-11-23)**

- `pg_hba.conf`는 원본(`pg_hba.conf.bak`) 대비 위 dev·prod 허용 줄만 추가됨.
- `listen_addresses = 'localhost,10.10.22.10'`은 `ALTER SYSTEM`으로 `/var/lib/postgresql/16/main/postgresql.auto.conf`에 저장되며 실제 적용값 동일.
- `postgresql.conf`는 설치 시점 그대로. 세 파일 모두 11/13 이후 수정 없음.

### Secret 만들기 (dev)

Menu를 제외한 Auth·Inventory·Order·Payment·Cooking 공통 절차입니다. `<서비스>`만 바꿔 씁니다. Menu는 키 이름이 달라 아래 'Menu' 절차를 따릅니다.

```bash
hostname                                   # dev인지 확인. prod면 멈춘다
kubectl -n peakorder get secret --show-labels | grep service-db   # 같은 이름이 있으면 덮어쓰지 않는다
set +o xtrace   # 명령 추적이 켜져 있으면 끈다(비밀번호가 출력되지 않게)
read -s -p "<서비스>_dev_user 비밀번호: " DBPW; echo               # 화면·기록에 남지 않게 입력
kubectl -n peakorder create secret generic <서비스>-service-db \
  --from-literal=DB_URL=jdbc:postgresql://10.10.22.10:5432/<서비스>_dev \
  --from-literal=DB_USER=<서비스>_dev_user \
  --from-file=DB_PASSWORD=<(printf '%s' "$DBPW")
unset DBPW
kubectl -n peakorder label secret <서비스>-service-db app=<서비스>-service team=team02
kubectl -n peakorder describe secret <서비스>-service-db           # 키 3개와 크기만 확인(값은 안 보임)
```

- 금지: `kubectl get secret -o yaml` 결과를 공유하지 않는다(base64는 암호화가 아님).
- 비밀번호는 `--from-file`과 프로세스 치환으로 넘겨 kubectl 명령 인수(프로세스 목록)에 남지 않게 한다. `printf`는 셸 내장 명령이라 별도 프로세스 인수가 생기지 않는다.
- 연결 풀: #186 기준으로 서비스 Deployment에 `SPRING_DATASOURCE_HIKARI_MAXIMUM_POOL_SIZE=4`, `SPRING_DATASOURCE_HIKARI_MINIMUM_IDLE=1`을 권장합니다(t2-db 한 대에 DB 12개, `max_connections` 100).

현황 (2026-11-23)

| Secret | 상태 |
|---|---|
| `order-service-db`, `payment-service-db`, `cooking-service-db` | 기존 |
| `auth-service-db`, `inventory-service-db` | 11/23 DB 담당 생성 |
| `menu-service-db` | 아직 없음 |

#### Menu (`menu-service-db`, 키 이름이 다름)

```bash
set +o xtrace
read -s -p "menu_dev_user 비밀번호: " DBPW; echo
kubectl -n peakorder create secret generic menu-service-db \
  --from-literal=MENU_DB_URL=jdbc:postgresql://10.10.22.10:5432/menu_dev \
  --from-literal=MENU_DB_USERNAME=menu_dev_user \
  --from-file=MENU_DB_PASSWORD=<(printf '%s' "$DBPW")
unset DBPW
kubectl -n peakorder label secret menu-service-db app=menu-service team=team02
kubectl -n peakorder describe secret menu-service-db
```

키는 `deploy/apps/menu-service/README.md`의 Secret 표를 따른다. 실제로 만들기 전에 Menu 담당과 키 이름을 확인한다.

### 접속이 안 될 때

| 오류 | 뜻 | 확인할 것 |
|---|---|---|
| `no pg_hba.conf entry for host` | 출입 명단에 없는 주소나 DB | dev 클러스터에서 prod DB에 접속하지 않았는지, DB 이름이 맞는지 |
| `fe_sendauth: no password supplied` | 비밀번호가 전달되지 않음 | Deployment가 Secret의 `DB_PASSWORD`를 읽는지 |
| `password authentication failed` | 비밀번호가 틀림 | Secret 값, 계정 이름 |
| `Connection refused` / 시간 초과 | DB가 꺼졌거나 문이 닫힘 | t2-db에서 `sudo systemctl status postgresql`, `sudo ss -tlnp \| grep 5432` |

파드 안에서 비밀번호를 직접 입력하지 않습니다. `kubectl run -it` 세션은 컨테이너 로그에 남을 수 있습니다.

### 백업 확인과 복원

```bash
# 어젯밤 백업 결과 (OK 12줄이면 정상)
sudo tail -n 12 /var/backups/postgresql/peakorder/backup.log

# 시험용 DB에 되살려 보기 (진짜 DB는 건드리지 않음)
cd /tmp
sudo -u postgres createdb restore_test
sudo -u postgres pg_restore --no-owner -d restore_test /var/backups/postgresql/peakorder/<DB>_<날짜>.dump
sudo -u postgres psql -d restore_test -c "\dt"
sudo -u postgres dropdb restore_test
```

- 스크립트: `/usr/local/bin/pg-backup-peakorder.sh`
- 예약: `/etc/cron.d/pg-backup-peakorder` (매일 03:00 KST, postgres 계정)
- 백업 파일은 t2-db에만 있으므로 VM 자체가 고장 나면 함께 사라집니다.

**시험 기록**

| 날짜 | 내용 |
|---|---|
| 2026-11-17 | 백업 파일 12개 생성만 확인 |
| 2026-11-23 09:28 | `order_dev_2026-11-23.dump`(03:00 백업)를 `restore_test`에 `pg_restore --no-owner` → 오류 없이 표 9개 복원 확인 → `dropdb restore_test` |

### 비밀번호 바꾸기

```bash
sudo -u postgres psql -c "\password <계정>"
```

바꾼 뒤 해당 서비스의 Secret도 함께 바꿔야 합니다.
