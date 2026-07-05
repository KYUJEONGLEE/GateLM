-- CreateTable
CREATE TABLE "conversations" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "endUserId" TEXT,
    "title" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "contextRetentionEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "safeContent" TEXT,
    "contentPolicy" TEXT NOT NULL DEFAULT 'retained',
    "requestId" TEXT,
    "parentMessageId" UUID,
    "sequence" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "conversations_tenantId_projectId_applicationId_deletedAt_idx" ON "conversations"("tenantId", "projectId", "applicationId", "deletedAt");

-- CreateIndex
CREATE INDEX "conversations_applicationId_updatedAt_idx" ON "conversations"("applicationId", "updatedAt");

-- CreateIndex
CREATE INDEX "conversations_endUserId_idx" ON "conversations"("endUserId");

-- CreateIndex
CREATE UNIQUE INDEX "chat_messages_conversationId_sequence_key" ON "chat_messages"("conversationId", "sequence");

-- CreateIndex
CREATE INDEX "chat_messages_tenantId_projectId_applicationId_idx" ON "chat_messages"("tenantId", "projectId", "applicationId");

-- CreateIndex
CREATE INDEX "chat_messages_conversationId_sequence_idx" ON "chat_messages"("conversationId", "sequence");

-- CreateIndex
CREATE INDEX "chat_messages_requestId_idx" ON "chat_messages"("requestId");

-- CreateIndex
CREATE INDEX "chat_messages_parentMessageId_idx" ON "chat_messages"("parentMessageId");

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_parentMessageId_fkey" FOREIGN KEY ("parentMessageId") REFERENCES "chat_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
