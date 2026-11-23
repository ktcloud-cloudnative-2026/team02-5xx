-- Peak Order Menu Service: development-only example data.
-- One-time seed. Never run against prod; do not place under Flyway migration.
-- Run with psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 5432 -U menu_dev_user -d menu_dev -W -f seed-menu-dev.sql
-- Safety: refuse databases other than menu_dev; refuse nonempty menu tables.
-- On any error, the entire transaction is rolled back.
BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $target$
BEGIN
    IF current_database() <> 'menu_dev' THEN
        RAISE EXCEPTION 'Dev seed refused: current database is %, expected menu_dev', current_database();
    END IF;
END;
$target$;

LOCK TABLE public.categories, public.menus, public.menu_options IN SHARE ROW EXCLUSIVE MODE;

DO $empty$
BEGIN
    IF EXISTS (SELECT 1 FROM public.categories)
       OR EXISTS (SELECT 1 FROM public.menus)
       OR EXISTS (SELECT 1 FROM public.menu_options) THEN
        RAISE EXCEPTION 'Dev seed refused: menu tables are not empty (no existing data was changed)';
    END IF;
END;
$empty$;

INSERT INTO public.categories (name, sort_order) VALUES
    ('버거', 10),
    ('사이드', 20),
    ('음료', 30),
    ('디저트', 40);

INSERT INTO public.menus
    (category_id, name, description, image_url, base_price, cook_time_sec, status)
SELECT
    c.id, seed.name, seed.description, seed.image_url,
    seed.base_price, seed.cook_time_sec, seed.status
FROM (VALUES
    ('버거', '클래식 버거', '소고기 패티와 신선한 채소가 들어간 기본 버거', NULL, 6500, 180, 'ON_SALE'),
    ('버거', '치즈 버거', '체다치즈와 소고기 패티를 함께 즐기는 버거', NULL, 7200, 200, 'ON_SALE'),
    ('버거', '더블 버거', '패티가 두 장 들어가는 버거', NULL, 9800, 260, 'PAUSED'),
    ('버거', '스파이시 치킨 버거', '매운 소스와 치킨 패티가 들어간 버거', NULL, 7800, 220, 'HIDDEN'),
    ('사이드', '프렌치프라이', '바삭한 감자튀김', NULL, 2800, 90, 'ON_SALE'),
    ('사이드', '어니언링', '바삭하게 튀긴 양파 링', NULL, 3500, 120, 'ON_SALE'),
    ('사이드', '치킨너겟', '한입 크기의 치킨너겟', NULL, 4500, 150, 'PAUSED'),
    ('음료', '콜라', '차가운 탄산음료', NULL, 2000, 0, 'ON_SALE'),
    ('음료', '아이스 아메리카노', NULL, NULL, 2800, 30, 'ON_SALE'),
    ('음료', '레몬 에이드', '레몬 향이 산뜻한 탄산음료', NULL, 3500, 45, 'ON_SALE'),
    ('디저트', '바닐라 아이스크림', '부드러운 바닐라 아이스크림', NULL, 3000, 40, 'ON_SALE'),
    ('디저트', '초코 브라우니', '진한 초콜릿 브라우니', NULL, 4200, 60, 'HIDDEN')
) AS seed (category_name, name, description, image_url, base_price, cook_time_sec, status)
JOIN public.categories AS c ON c.name = seed.category_name
ORDER BY c.sort_order, seed.name;

INSERT INTO public.menu_options
    (menu_id, name, extra_price, extra_cook_time_sec, is_default, active)
SELECT
    m.id, seed.name, seed.extra_price, seed.extra_cook_time_sec,
    seed.is_default, seed.active
FROM (VALUES
    ('클래식 버거', '치즈 추가', 700, 0, FALSE, TRUE),
    ('클래식 버거', '세트 변경', 2500, 60, FALSE, TRUE),
    ('클래식 버거', '양파 제외', 0, 0, FALSE, TRUE),
    ('치즈 버거', '패티 추가', 2500, 90, FALSE, TRUE),
    ('치즈 버거', '세트 변경', 2500, 60, FALSE, TRUE),
    ('더블 버거', '세트 변경', 2500, 60, FALSE, TRUE),
    ('더블 버거', '매운 소스', 300, 0, FALSE, FALSE),
    ('스파이시 치킨 버거', '세트 변경', 2500, 60, FALSE, TRUE),
    ('프렌치프라이', '라지 사이즈', 1000, 20, FALSE, TRUE),
    ('프렌치프라이', '소금 제외', 0, 0, FALSE, TRUE),
    ('프렌치프라이', '케첩 추가', 0, 0, FALSE, TRUE),
    ('어니언링', '소스 추가', 500, 0, FALSE, TRUE),
    ('치킨너겟', '허니머스터드', 0, 0, TRUE, TRUE),
    ('치킨너겟', '바비큐 소스', 0, 0, FALSE, TRUE),
    ('콜라', '기본 사이즈', 0, 0, TRUE, TRUE),
    ('콜라', '라지 사이즈', 500, 0, FALSE, TRUE),
    ('레몬 에이드', '시럽 추가', 500, 0, FALSE, TRUE),
    ('바닐라 아이스크림', '초코 시럽', 500, 0, FALSE, TRUE),
    ('바닐라 아이스크림', '견과 토핑', 800, 0, FALSE, FALSE),
    ('초코 브라우니', '아이스크림 추가', 1200, 40, FALSE, TRUE)
) AS seed (menu_name, name, extra_price, extra_cook_time_sec, is_default, active)
JOIN public.menus AS m ON m.name = seed.menu_name
ORDER BY m.id, seed.name;

DO $assert$
BEGIN
    IF (SELECT count(*) FROM public.categories) <> 4
       OR (SELECT count(*) FROM public.menus) <> 12
       OR (SELECT count(*) FROM public.menu_options) <> 20
       OR (SELECT count(*) FROM public.menus WHERE status = 'ON_SALE') <> 8
       OR (SELECT count(*) FROM public.menus WHERE status = 'PAUSED') <> 2
       OR (SELECT count(*) FROM public.menus WHERE status = 'HIDDEN') <> 2 THEN
        RAISE EXCEPTION 'Dev seed verification failed; rolling back all inserted data';
    END IF;
END;
$assert$;

COMMIT;

SELECT 'categories' AS table_name, count(*) AS row_count FROM public.categories
UNION ALL SELECT 'menus', count(*) FROM public.menus
UNION ALL SELECT 'menu_options', count(*) FROM public.menu_options
ORDER BY table_name;

SELECT status, count(*) AS row_count
FROM public.menus
GROUP BY status
ORDER BY status;
