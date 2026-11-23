# 런북

[← README](../README.md)

> 시작용 예시입니다. 팀에서 정한 내용으로 고치거나, 필요 없으면 지워도 됩니다.
>
> 외부 도구로 써도 됩니다(추천: [Notion](https://www.notion.so)). 그 경우 이 파일에는 링크와 한 줄 요약만 남깁니다.

장애가 났을 때 처음 보는 팀원도 그대로 따라 할 수 있게 씁니다. 해결한 [트러블슈팅 이슈](../../../issues?q=label%3Abug) 중 반복될 것을 여기로 옮깁니다.

## 공통 확인 순서
1. 어느 서비스 · 환경인가 — 대시보드에서 에러율이 오른 서비스 확인
2. `kubectl get pods -n <네임스페이스>` — 상태 · 재시작 수
3. `kubectl describe pod <파드> -n <네임스페이스>` — Events
4. `kubectl logs <파드> -n <네임스페이스> --previous` — 직전에 죽은 컨테이너 로그
5. 최근 배포 확인 — Argo CD 이력, 최근 merge된 PR

## 장애별 대응

### <증상 — 예: 파드가 CrashLoopBackOff>
| 항목 | 내용 |
|---|---|
| 확인할 명령 | |
| 흔한 원인 | |
| 조치 | |
| 되돌리기 | <예: Argo CD에서 이전 버전으로 Sync> |
| 관련 이슈 | # |


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
