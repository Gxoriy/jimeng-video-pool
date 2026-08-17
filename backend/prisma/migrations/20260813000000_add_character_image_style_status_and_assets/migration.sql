-- 修复需求一/二中新增字段的迁移漂移：
-- 1) character_images 缺 style / status 两列，导致「追加图片到形象」接口运行时报错（导入崩溃）；
-- 2) assets 表未创建，导致后端 /api/assets/sync 同步素材 URL 失败。

-- AlterTable
ALTER TABLE "character_images" ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'active',
ADD COLUMN     "style" TEXT;

-- CreateTable
CREATE TABLE "assets" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT,
    "description" TEXT,
    "tags" TEXT[],
    "work_info" JSONB,
    "source" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "assets_url_key" ON "assets"("url");

-- CreateIndex
CREATE INDEX "assets_kind_idx" ON "assets"("kind");
