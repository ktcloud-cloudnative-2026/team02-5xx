-- IN-06 재고 항목 논리 삭제: 삭제 시각을 기록하고 행은 남긴다 (이력·확보 기록 보존)
ALTER TABLE inventories ADD COLUMN deleted_at TIMESTAMPTZ;
