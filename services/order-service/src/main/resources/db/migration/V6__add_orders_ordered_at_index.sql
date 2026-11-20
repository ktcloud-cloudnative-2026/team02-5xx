-- 관리자 주문 목록·검색(OR-08)은 기간(주문 시각)으로 거른 뒤 최신순으로 정렬한다 (이슈 #168).
-- 기존 idx_orders_user_id_ordered_at은 사용자 조건이 없는 이 조회에 쓸 수 없어 주문 시각 단독 인덱스를 추가한다.
-- 인덱스만 추가하므로 기존 데이터와 동작에 영향이 없다.
CREATE INDEX idx_orders_ordered_at ON orders (ordered_at DESC, id DESC);
