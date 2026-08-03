-- AlterTable
ALTER TABLE "songs" ADD COLUMN "cover_url" TEXT;
ALTER TABLE "songs" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'active';

-- CreateIndex
CREATE INDEX "songs_status_idx" ON "songs"("status");
