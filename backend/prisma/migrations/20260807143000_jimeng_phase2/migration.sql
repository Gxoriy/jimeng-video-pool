-- 即梦 Phase 2：任务体系统一 + 每日签到 + 积分消耗记录

-- TaskType 枚举新增即梦类型（PostgreSQL 12+ 支持事务内 ADD VALUE）
ALTER TYPE "TaskType" ADD VALUE IF NOT EXISTS 'jimeng_image';
ALTER TYPE "TaskType" ADD VALUE IF NOT EXISTS 'jimeng_video';

-- 即梦账号：每日签到时间
ALTER TABLE "jimeng_accounts" ADD COLUMN IF NOT EXISTS "last_checkin_at" TIMESTAMP(3);

-- 即梦任务：记录实际使用账号与消耗积分（用于选号权重调整）
ALTER TABLE "jimeng_tasks" ADD COLUMN IF NOT EXISTS "account_id" TEXT;
ALTER TABLE "jimeng_tasks" ADD COLUMN IF NOT EXISTS "credits_used" INTEGER;
CREATE INDEX IF NOT EXISTS "jimeng_tasks_account_id_idx" ON "jimeng_tasks"("account_id");
