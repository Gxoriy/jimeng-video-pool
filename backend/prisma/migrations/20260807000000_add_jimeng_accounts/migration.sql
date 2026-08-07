-- CreateTable
CREATE TABLE "jimeng_accounts" (
    "id" TEXT NOT NULL,
    "label" TEXT,
    "cookie_enc" TEXT NOT NULL,
    "sessionid" TEXT NOT NULL,
    "expire_at" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'active',
    "credits" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'local',
    "last_used_at" TIMESTAMP(3),
    "last_check_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jimeng_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jimeng_tasks" (
    "taskId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "progress" TEXT,
    "result_json" JSONB,
    "user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "jimeng_tasks_pkey" PRIMARY KEY ("taskId")
);

-- CreateIndex
CREATE INDEX "jimeng_accounts_status_idx" ON "jimeng_accounts"("status");

-- CreateIndex
CREATE INDEX "jimeng_tasks_user_id_idx" ON "jimeng_tasks"("user_id");
