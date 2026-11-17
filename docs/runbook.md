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
| 비밀번호 | 문서·Git·채팅에 기록하지 않음. 전달·Secret 방식은 [미정: GitOps 담당과 협의 중] |
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

### 비밀번호 바꾸기

```bash
sudo -u postgres psql -c "\password <계정>"
```

바꾼 뒤 해당 서비스의 Secret도 함께 바꿔야 합니다.
