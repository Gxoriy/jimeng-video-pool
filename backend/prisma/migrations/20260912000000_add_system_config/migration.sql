-- 修复：SystemConfig 模型此前缺少建表迁移，导致 JimengEnabledGuard 在每次访问即梦后台接口
-- （含 cookie 导入）时查询 system_config 表抛 Prisma P2021，被兜底过滤器转成「服务器内部错误」。
-- 使用 IF NOT EXISTS 以兼容已通过 `prisma db push` 建表的环境（避免重复建表报错）。
CREATE TABLE IF NOT EXISTS "system_config" (
    "key" TEXT NOT NULL,
    "value" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_config_pkey" PRIMARY KEY ("key")
);
