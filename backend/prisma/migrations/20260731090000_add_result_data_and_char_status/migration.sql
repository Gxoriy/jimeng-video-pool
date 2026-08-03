-- 支持「获取灵感」返回结构化结果（形象提示词 + 动作提示词）
ALTER TABLE tasks ADD COLUMN result_data JSONB;

-- 形象库增加入库状态：pending_review=AI 识别后待人工审核归档；active=已归档
ALTER TABLE characters ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
CREATE INDEX IF NOT EXISTS idx_characters_status ON characters (status);
