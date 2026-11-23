-- Peak Order Inventory Service: development-only stock seed (#234).
-- One-time seed for inventory_dev. Never run against prod; do not place under Flyway migration.
-- Menu IDs come from the Menu dev seed (#217, PR #218) applied to menu_dev on 2026-11-23:
--   1 더블 버거(PAUSED), 3 치즈 버거, 4 클래식 버거, 5 어니언링, 6 치킨너겟(PAUSED),
--   7 프렌치프라이, 8 레몬 에이드, 9 아이스 아메리카노, 10 콜라, 11 바닐라 아이스크림.
--   HIDDEN 메뉴 2·12는 연결하지 않는다(IN-05: HIDDEN 연결 금지). PAUSED는 연결 가능(MI-02 합의).
-- Quantities are arbitrary test values: 7 is low stock (3 <= 5), 8 is sold out (0).
-- Run: psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 5432 -U inventory_dev_user -d inventory_dev -W -f seed-inventory-dev.sql
-- Safety: refuse databases other than inventory_dev; refuse nonempty inventory tables.
-- On any error, the entire transaction is rolled back.
BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $target$
BEGIN
    IF current_database() <> 'inventory_dev' THEN
        RAISE EXCEPTION 'Dev seed refused: current database is %, expected inventory_dev', current_database();
    END IF;
END;
$target$;

LOCK TABLE public.inventories, public.inventory_reservations IN SHARE ROW EXCLUSIVE MODE;

DO $empty$
BEGIN
    IF EXISTS (SELECT 1 FROM public.inventories)
       OR EXISTS (SELECT 1 FROM public.inventory_reservations) THEN
        RAISE EXCEPTION 'Dev seed refused: inventory tables are not empty (no existing data was changed)';
    END IF;
END;
$empty$;

INSERT INTO public.inventories (menu_id, stock_qty, reserved_qty, low_stock_threshold) VALUES
    (1, 20, 0, 5),
    (3, 50, 0, 5),
    (4, 50, 0, 5),
    (5, 30, 0, 5),
    (6, 20, 0, 5),
    (7, 3, 0, 5),
    (8, 0, 0, 3),
    (9, 100, 0, 10),
    (10, 100, 0, 10),
    (11, 20, 0, 5);

DO $verify$
DECLARE
    total_count integer;
    sold_out_count integer;
    low_stock_count integer;
BEGIN
    SELECT count(*),
           count(*) FILTER (WHERE stock_qty - reserved_qty = 0),
           count(*) FILTER (WHERE stock_qty - reserved_qty <= low_stock_threshold)
      INTO total_count, sold_out_count, low_stock_count
      FROM public.inventories;
    IF total_count <> 10 OR sold_out_count <> 1 OR low_stock_count <> 2 THEN
        RAISE EXCEPTION 'Dev seed verification failed: total=% sold_out=% low_stock=%',
            total_count, sold_out_count, low_stock_count;
    END IF;
END;
$verify$;

COMMIT;

SELECT count(*) AS inventories,
       count(*) FILTER (WHERE stock_qty - reserved_qty = 0) AS sold_out,
       count(*) FILTER (WHERE stock_qty - reserved_qty <= low_stock_threshold) AS low_stock
  FROM public.inventories;
