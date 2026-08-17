-- 个人设置：Hedra 提示词扩写 cookie（加密存储，覆盖全局 .env HEDRA_COOKIE_PATH）
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "hedra_cookie_enc" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "hedra_cookie_at" TIMESTAMP(3);
