-- CreateTable
CREATE TABLE "ai_channels" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "protocol" TEXT NOT NULL DEFAULT 'openai',
    "baseUrl" TEXT NOT NULL,
    "api_key_enc" TEXT NOT NULL,
    "model" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "owner_user_id" TEXT,
    "context1m" BOOLEAN NOT NULL DEFAULT false,
    "streaming" BOOLEAN NOT NULL DEFAULT false,
    "workspaceDisplay" BOOLEAN NOT NULL DEFAULT false,
    "scoringAvailable" BOOLEAN NOT NULL DEFAULT false,
    "proxy_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_channels_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_channels_owner_user_id_idx" ON "ai_channels"("owner_user_id");

-- CreateIndex
CREATE INDEX "ai_channels_enabled_idx" ON "ai_channels"("enabled");

-- AddForeignKey
ALTER TABLE "ai_channels" ADD CONSTRAINT "ai_channels_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
