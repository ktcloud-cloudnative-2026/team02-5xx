# Menu prod 초기 데이터 Seed

관련 Issue: #432, 원본 dev Seed: #217 / PR #218.
사용자가 승인한 기존 구성을 prod 최초 등록용으로 준비한 **수동 psql 전용** SQL입니다.
Flyway 마이그레이션 경로 밖에 있으며, 파일 병합이나 애플리케이션 배포만으로 실행되지 않습니다.
이번 작업은 실제 dev/prod DB에 접속하거나 데이터를 등록하지 않습니다.

## 데이터와 범위

- 카테고리 4개: 버거, 사이드, 음료, 디저트. 정렬 순서 10/20/30/40.
- 메뉴 12개: ON_SALE 8개, PAUSED 2개, HIDDEN 2개.
- 옵션 20개: 이름, 추가 가격·조리 시간, 기본값 및 활성 상태를 원본 그대로 유지합니다.
- 메뉴 이름·설명·가격·조리 시간과 INSERT 정렬도 `../dev/seed-menu-dev.sql`과 같습니다.
  INSERT 블록은 원본을 그대로 사용하며 dev SQL과 Flyway V1은 수정하지 않습니다.
- `image_url`은 12개 모두 NULL입니다. #422/#431의 이름 매핑은 Frontend 정책이며
  DB 이미지 URL 등록이나 실제 이미지 배포 완료를 의미하지 않습니다.
- 숨김 메뉴 2개도 승인된 초기 구성의 일부입니다. 실제 dev 데이터의 현재 존재 여부를 단정하지 않습니다.
- ID는 PostgreSQL identity가 생성합니다. dev ID를 복사·강제 지정하거나 sequence를 초기화하지 않습니다.
  카테고리 이름으로 메뉴를, 메뉴 이름으로 옵션을 연결합니다.
- Inventory DB·재고·연결 ID·수량은 이 SQL의 범위가 아닙니다.

## 안전장치

1. `current_database()`가 정확히 `menu_prod`가 아니면 거절합니다.
2. `public.flyway_schema_history`의 성공한 V1과 세 업무 테이블의 존재를 확인합니다.
   스키마 생성·수정은 하지 않습니다. Flyway 상태가 없거나 성공하지 않았으면 먼저 원인을 해결합니다.
3. 단일 트랜잭션 안에서 세 테이블에 `SHARE ROW EXCLUSIVE` 잠금을 획득한 다음
   어느 테이블이든 한 행이라도 있으면 거절합니다. 기존 행을 갱신·삭제하지 않습니다.
4. COMMIT 전에 4/12/20, 상태별 8/2/2 및 이미지 NULL을 검증합니다. 불일치 시 예외를 발생시킵니다.
5. 잠금 대기 5초, statement 30초 제한과 psql `ON_ERROR_STOP`을 사용합니다.

DB 이름만으로 실제 접속 대상을 식별할 수는 없습니다. 같은 이름의 로컬 DB도 있으므로
호스트·포트·계정·서버 식별을 실행 전에 반드시 대조합니다.
조회는 잠금 중에도 가능하므로 초기 영업을 닫고 관리자 쓰기·다른 초기화·마이그레이션과 시간을 조율합니다.

## 실제 prod 실행 선행 조건

- 이 변경의 DB 담당 리뷰, CI 및 병합과 **별도 실제 prod 실행 승인**을 확인합니다.
- prod DB/Secret 담당자와 DB 생성·소유권·접속 계정·권한을 확인합니다.
  대상 계정에 필요한 테이블 SELECT/INSERT, identity sequence 사용 및 잠금 권한이 있어야 합니다.
- 승인된 Menu 이미지와 GitOps 설정의 배포, Argo CD Sync/Healthy 및 Flyway V1 성공을 확인합니다.
  배포 준비·실제 기동은 이 SQL의 로컬 검증 결과로 대체하지 않습니다.
- 초기 영업 닫힘, 기존 세 테이블이 모두 비어 있음, 다른 쓰기 작업이 없음을 확인합니다.
- DB 백업·복구 책임자, 실행자·검토자·실행 시간과 실패 시 연락 절차를 합의합니다.
- SQL의 승인 commit과 파일 해시를 확인합니다. 비밀번호·Secret·접속 문자열의 비밀값은
  SQL, Git, 명령 기록, 결과 파일에 남기지 않습니다.

## 실행 전 확인

승인된 DB 접속 환경에서 다음을 확인합니다. 테이블·history가 없으면 이 단계에서 중단합니다.

```sql
SELECT current_database(), current_user, inet_server_addr(), inet_server_port(), version();

SELECT version, description, script, success
FROM public.flyway_schema_history
WHERE version = '1';

SELECT to_regclass('public.categories'), to_regclass('public.menus'),
       to_regclass('public.menu_options');

SELECT 'categories' AS table_name, count(*) FROM public.categories
UNION ALL SELECT 'menus', count(*) FROM public.menus
UNION ALL SELECT 'menu_options', count(*) FROM public.menu_options;
```

## 수동 실행

아래 변수는 실행자가 승인된 **비밀값이 아닌** 호스트·포트·계정으로 설정하고 재확인합니다.
실행 파일 경로는 검토된 SQL을 전달한 위치로 바꿉니다. 기존 dev SQL을 실행하지 않습니다.

```bash
psql -X -v ON_ERROR_STOP=1 \
  -h "$MENU_PROD_HOST" -p "$MENU_PROD_PORT" \
  -U "$MENU_PROD_USER" -d menu_prod -W \
  -f /approved/path/seed-menu-prod.sql
```

비밀번호는 `-W` 프롬프트에서 입력합니다. URI·명령 인자·SQL에 넣거나 화면 출력에 복사하지 않습니다.
`-X`는 사용자 psql 시작 파일의 영향을 배제합니다. SQL에도 `ON_ERROR_STOP`이 지정돼 있습니다.
다른 SQL과 묶거나 외부 BEGIN 안에서 실행하지 말고, 별도 psql 연결의 `-f`로 한 번 실행합니다.
종료 코드와 COMMIT 성공을 확인한 뒤 결과를 확인합니다.

## 실행 후 확인 및 Inventory 인계

성공 시 SQL은 건수·판매 상태별 건수, 실제 카테고리 ID/이름/정렬 순서 및
메뉴 ID/이름/상태/카테고리 대응표를 출력합니다. 필요하면 아래 조회로 다시 확인합니다.

```sql
SELECT status, count(*) FROM public.menus GROUP BY status ORDER BY status;
SELECT count(*) AS non_null_image_urls FROM public.menus WHERE image_url IS NOT NULL;
SELECT id AS category_id, name AS category_name, sort_order
FROM public.categories ORDER BY sort_order, id;
SELECT m.id AS menu_id, m.name AS menu_name, m.status,
       c.id AS category_id, c.name AS category_name
FROM public.menus m JOIN public.categories c ON c.id = m.category_id
ORDER BY c.sort_order, m.id;
```

기대 결과는 4/12/20, ON_SALE 8 / PAUSED 2 / HIDDEN 2, 이미지 URL 비NULL 0건입니다.
실행 환경·시각·SQL commit/해시·검증 결과와 실제 ID 대응표를 비밀값 없이 보관하고,
Inventory 담당자에게 승인된 전달 수단으로 전달합니다. 담당자는 dev ID를 가정하지 않고
실제 prod 메뉴 ID·이름·상태를 대조합니다. 전달은 운영자가 수행하며 이 작업에서 메시지를 보내지 않습니다.
Inventory 초기화·연결·수량 결정은 별도 승인 작업이며 이 SQL에서 타 DB를 조회하거나 수정하지 않습니다.

## 오류·재실행·복구

- 오류가 나면 psql `-f`/`ON_ERROR_STOP`으로 연결이 종료되며 미커밋 삽입은 전체 롤백됩니다.
  대화형 연결에서 직접 실행했다면 실패한 트랜잭션을 COMMIT하지 말고 ROLLBACK/연결 종료 후 확인합니다.
- 실패 원인, 실행 종료 코드, 연결 대상 및 세 테이블 상태를 확인하고 DB 담당자와 재실행 여부를 결정합니다.
  잠금 timeout이 났다고 다른 쓰기 프로세스를 임의 종료하지 않습니다.
- 성공 후 재실행은 빈 테이블 조건에서 거절됩니다. 중복 등록을 성공으로 처리하지 않습니다.
- COMMIT 후 결과 출력·연결 오류가 발생했으면 성공 여부가 불분명할 수 있습니다.
  위 조회로 먼저 확인하고, SQL을 무작정 다시 실행하거나 데이터를 삭제하지 않습니다.
- identity sequence의 증가는 롤백되지 않을 수 있습니다. ID의 연속성은 보장하지 않으며
  누락 번호를 채우기 위해 sequence를 되돌리거나 강제 ID를 삽입하지 않습니다.
- 성공한 데이터를 자동 삭제·강제 초기화하는 SQL은 제공하지 않습니다.
  후속 수정·삭제는 주문/재고 연결 등 영향을 조사하고 DB 담당자와 별도 Issue/PR·복구 승인을 거칩니다.

## 로컬 검증 기록

2026-11-27, 기준 main `35c408a06f0a666685fa587653c2799dc8aac6b4`.
Windows의 기존 격리 검증용 PostgreSQL **16.16** 바이너리를 재사용했습니다.
검증 종료 시 main은 #407 병합으로 `53f0ef79d02fb6050d6dc342887c9585902b93a7`로 진행했습니다.
추가 변경은 배포 문서·dev probe이며 원본 dev Seed·V1·이번 두 파일과 겹치지 않습니다.
최초 검증 시 병합 금지 범위를 지켜 작업 브랜치는 위 시작 기준에 유지했습니다.
후속 사용자 승인으로 최신 main `53f0ef79d02fb6050d6dc342887c9585902b93a7`을 fast-forward 반영했습니다.
검증한 prod SQL·원본 dev Seed·Flyway V1의 해시가 동일해 아래 15건의 SQL 실행 결과를 재사용합니다.
새 임시 data directory, loopback 전용 별도 포트 **55359**, 로컬 전용 계정으로 실행하고
실제 `data_directory`·서버 주소·포트·버전을 대조했습니다. 격리 인스턴스에만 trust 인증을 사용했으며
실제 환경의 인증 설정을 바꾸지 않았습니다. 공유 DB 및 Inventory DB에는 접속하지 않았습니다.

기존 캐시의 Flyway **12.4.0**과 Java 21로 원본 V1을 실제 migrate해 history를 만들고,
`psql -X -v ON_ERROR_STOP=1`로 원본 dev SQL 및 prod SQL을 실행했습니다.
로컬 `menu_prod` identity를 미리 소비해 ID가 dev와 달라도 이름 기준 데이터·관계가 같은지 비교했습니다.
비교 대상은 카테고리 정렬, 메뉴 업무 필드 전체, 옵션 업무 필드 전체와 FK 관계이며,
DB 자동 생성 ID 및 생성/갱신 시각은 값 비교에서 제외합니다.

| 검증                                          | 실제 결과                                                         |
| --------------------------------------------- | ----------------------------------------------------------------- |
| 정상 실행·건수·판매 상태                      | PASS: 4/12/20 및 8/2/2                                            |
| dev Seed 데이터·FK 관계 대조                  | PASS: 생성 ID 차이와 무관하게 동일                                |
| image_url NULL·실제 ID 대응표 출력            | PASS                                                              |
| 다른 DB 이름                                  | PASS: 로컬 menu_dev에서 거절, 삽입 없음                           |
| Flyway 미적용 / V1 테이블만 있고 history 없음 | PASS: 두 경우 모두 거절                                           |
| 성공하지 않은 V1 / 대상 테이블 누락           | PASS: 두 경우 모두 거절                                           |
| categories / menus / menu_options 기존 데이터 | PASS: 각 경우 거절·기존 데이터 동일                               |
| 성공 후 재실행                                | PASS: 거절·기존 데이터 동일                                       |
| 메뉴 INSERT 이후 중간 오류                    | PASS: 테스트 SQL 복사본에만 0 나눗셈 주입, 전체 삽입 0건으로 롤백 |
| COMMIT 전 예상 건수 불일치                    | PASS: 로컬 테스트 trigger로 옵션 한 건을 건너뛰게 해 전체 롤백    |

기존 데이터 검증은 FK를 만족시키기 위해 메뉴 사례에는 부모 카테고리를,
옵션 사례에는 부모 메뉴·카테고리도 함께 둔 상태로 비교했습니다.
오류 주입 복사본·trigger·반복 DB 생성은 임시 격리 검증에만 사용하며 배포 SQL에는 없습니다.
검증 로그·성공 ID 대응표는 저장소 밖의 해당 임시 QA 디렉터리에 보관하고,
종료 시 이번 검증용 PostgreSQL만 중지합니다. 공용 테스트/CI 체계는 추가하지 않습니다.

검증 실행 중 Windows 자식 프로세스가 출력 pipe를 유지하는 문제와 psql tuple-only 출력으로
헤더가 생략되는 검증기 문제를 해결한 뒤 재실행했습니다. Windows `psql -c`의 한글 인코딩 문제는
로컬 오류 주입문을 ASCII 표현으로 바꿔 해결했습니다. 업무 데이터 변경으로 해결하지 않았습니다.
실제 prod 권한·Secret·배포·Sync·Flyway 기동·동시 운영 부하·API 응답 및 Inventory 연결은 미검증입니다.
실제 prod 실행과 검증은 별도 승인 후 후속 운영 단계에서 수행합니다.
