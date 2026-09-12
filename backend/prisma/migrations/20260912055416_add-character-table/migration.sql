/*
  Warnings:

  - The values [digital_human] on the enum `PromptType` will be removed. If these variants are still used in the database, this will fail.
  - The values [image,digital_human] on the enum `TaskType` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `baseUrl` on the `ai_channels` table. All the data in the column will be lost.
  - You are about to drop the column `context1m` on the `ai_channels` table. All the data in the column will be lost.
  - You are about to drop the column `isSystem` on the `ai_channels` table. All the data in the column will be lost.
  - You are about to drop the column `owner_user_id` on the `ai_channels` table. All the data in the column will be lost.
  - You are about to drop the column `scoringAvailable` on the `ai_channels` table. All the data in the column will be lost.
  - You are about to drop the column `workspaceDisplay` on the `ai_channels` table. All the data in the column will be lost.
  - You are about to drop the `api_keys` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `base_url` to the `ai_channels` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "PromptType_new" AS ENUM ('character', 'action');
ALTER TABLE "prompts" ALTER COLUMN "type" TYPE "PromptType_new" USING ("type"::text::"PromptType_new");
ALTER TYPE "PromptType" RENAME TO "PromptType_old";
ALTER TYPE "PromptType_new" RENAME TO "PromptType";
DROP TYPE "PromptType_old";
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "TaskType_new" AS ENUM ('character', 'inspiration', 'video', 'jimeng_image', 'jimeng_video');
ALTER TABLE "tasks" ALTER COLUMN "type" TYPE "TaskType_new" USING ("type"::text::"TaskType_new");
ALTER TYPE "TaskType" RENAME TO "TaskType_old";
ALTER TYPE "TaskType_new" RENAME TO "TaskType";
DROP TYPE "TaskType_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "ai_channels" DROP CONSTRAINT "ai_channels_owner_user_id_fkey";

-- DropForeignKey
ALTER TABLE "api_keys" DROP CONSTRAINT "api_keys_owner_user_id_fkey";

-- DropIndex
DROP INDEX "ai_channels_owner_user_id_idx";

-- DropIndex
DROP INDEX "idx_characters_status";

-- AlterTable
ALTER TABLE "ai_channels" DROP COLUMN "baseUrl",
DROP COLUMN "context1m",
DROP COLUMN "isSystem",
DROP COLUMN "owner_user_id",
DROP COLUMN "scoringAvailable",
DROP COLUMN "workspaceDisplay",
ADD COLUMN     "base_url" TEXT NOT NULL,
ADD COLUMN     "remark" TEXT,
ADD COLUMN     "supports_image" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "supports_vision" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "usable_for" TEXT NOT NULL DEFAULT 'character,inspiration,song';

-- AlterTable
ALTER TABLE "prompts" ADD COLUMN     "created_by" TEXT,
ALTER COLUMN "type" SET DEFAULT 'character';

-- AlterTable
ALTER TABLE "songs" ADD COLUMN     "lyrics" TEXT;

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "result_text" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "runninghub_key_at" TIMESTAMP(3),
ADD COLUMN     "runninghub_key_enc" TEXT;

-- DropTable
DROP TABLE "api_keys";

-- DropEnum
DROP TYPE "KeyScope";

-- CreateTable
CREATE TABLE "uploads" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "local_path" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "mime_type" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "uploads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "uploads_user_id_idx" ON "uploads"("user_id");

-- CreateIndex
CREATE INDEX "tasks_type_idx" ON "tasks"("type");

-- AddForeignKey
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
