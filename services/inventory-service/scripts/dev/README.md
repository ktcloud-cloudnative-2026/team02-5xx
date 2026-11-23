# Inventory Service dev 초기 재고 시드

관련 Issue: #234. **dev 전용, 수동 실행 전용**입니다. 이 디렉터리는 Flyway의 `db/migration` 경로 밖에 있습니다. 파일이 `main`에 병합돼도 SQL은 자동 실행되지 않습니다.

관리자 API(IN-03 등록·IN-05 연결)는 dev에서 꺼져 있으므로(`INVENTORY_ADMIN_ENABLED=false`, 인가 #112 확정 전까지) 초기 재고는 이 SQL로 넣습니다.

## 범위와 테스트 포인트

- 재고 10건: 메뉴 1·3·4·5·6·7·8·9·10·11에 하나씩 연결
- HIDDEN 메뉴 2·12는 연결하지 않습니다(IN-05는 HIDDEN 연결을 거절). PAUSED 메뉴 1·6은 연결합니다(MI-02 합의).
- 품절 1건: 8 레몬 에이드(가용 0)
- 부족 2건: 7 프렌치프라이(가용 3 ≤ 기준 5), 8 레몬 에이드
- 수량은 시험용 임의 값입니다.
- 메뉴 ID는 2026-11-23 Menu dev 시드(#218) 결과에 맞췄습니다. Menu 데이터를 다시 만들면 ID가 달라질 수 있으니 이 SQL도 함께 확인합니다.

## 안전 장치

- SQL은 정확히 `inventory_dev` DB에서만 실행됩니다. 다른 DB면 예외를 발생시킵니다.
- `inventories`, `inventory_reservations` 중 하나라도 데이터가 있으면 실행을 거절합니다. 기존 데이터를 삭제하거나 수정하지 않습니다.
- 테이블 잠금과 단일 트랜잭션으로 중간 실패 시 부분 삽입을 막습니다.
- 삽입 후 전체·품절·부족 건수를 검증하고, 예상과 다르면 트랜잭션을 롤백합니다.
- **재실행은 성공 처리하지 않고 명시적으로 거절**합니다(중복 삽입 방지).
- 비밀번호는 SQL과 Git에 넣지 않습니다. `-W` 프롬프트로 입력합니다.
- prod에서 실행하지 않습니다.

## 실행 방법 (t2-db, DB 담당)

```bash
psql -X -v ON_ERROR_STOP=1 \
  -h 127.0.0.1 -p 5432 \
  -U inventory_dev_user -d inventory_dev -W \
  -f seed-inventory-dev.sql
```

예상 결과: `inventories=10`, `sold_out=1`, `low_stock=2`

## 적용 이후 확인

dev에서 `GET /api/v1/inventory/availability?menuIds=7,8,9` → 7·9는 `orderable=true`, 8은 `false`.

## 운영 및 복구

- 실행 중 오류가 나면 트랜잭션 전체가 롤백됩니다. `-v ON_ERROR_STOP=1`을 꼭 씁니다.
- 데이터를 바꾸거나 삭제해야 하면 DB 담당과 영향을 확인하고 **별도 Issue/PR**로 관리합니다.
