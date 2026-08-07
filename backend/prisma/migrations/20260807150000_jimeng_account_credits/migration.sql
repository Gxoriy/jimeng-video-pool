-- 即梦账号：新增累计消耗积分 + 连续签到天数（Phase 2 选号加权 + 养号统计）

ALTER TABLE "jimeng_accounts" ADD COLUMN IF NOT EXISTS "credits_used" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "jimeng_accounts" ADD COLUMN IF NOT EXISTS "checkin_streak" INTEGER NOT NULL DEFAULT 0;
