import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';

import { AppModule } from '@/app.module';
import { signAccessJwt } from '@/auth/auth.crypto';
import { ControlPlaneClient } from '@/auth/control-plane.client';
import { PrismaService } from '@/database/prisma.service';

import { ExecutionBridgeService } from './execution-bridge.service';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const prisma = app.get(PrismaService);
    const config = app.get(ConfigService);
    const now = Math.floor(Date.now() / 1000);
    const entitlement = await app.get(ControlPlaneClient).entitlement(
      '00000000-0000-4000-8000-000000000900',
      '00000000-0000-4000-8000-000000000100',
    );
    const session = await prisma.tenantChatSession.upsert({
      where: { id: '00000000-0000-4000-8000-000000000902' },
      create: {
        id: '00000000-0000-4000-8000-000000000902',
        userId: '00000000-0000-4000-8000-000000000900',
        selectedTenantId: '00000000-0000-4000-8000-000000000100',
        deviceIdHash: 'sha256:synthetic-smoke-device',
        sessionVersion: 1,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
      update: {
        selectedTenantId: '00000000-0000-4000-8000-000000000100',
        deviceIdHash: 'sha256:synthetic-smoke-device',
        sessionVersion: 1,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        revokedAt: null,
        revokeReason: null,
      },
    });
    const accessToken = signAccessJwt({
      actorAuthzVersion: entitlement.actorAuthzVersion,
      actorKind: entitlement.actorKind,
      aud: 'gatelm-chat-web',
      deviceIdHash: session.deviceIdHash,
      exp: now + 300,
      iat: now,
      iss: 'gatelm-chat-api',
      jti: randomUUID(),
      nbf: now - 1,
      sessionVersion: session.sessionVersion,
      sid: session.id,
      sub: session.userId,
      tenantAuthzVersion: entitlement.tenantAuthzVersion,
      tenantId: entitlement.tenantId,
      ...(entitlement.employeeId ? { employeeId: entitlement.employeeId } : {}),
    }, config.getOrThrow<string>('TENANT_CHAT_ACCESS_JWT_SECRET'));
    const bridge = app.get(ExecutionBridgeService);
    let deltaCount = 0;
    const handle = await bridge.authorizeAndAdmit(accessToken);
    const result = await bridge.complete(
      handle,
      { messages: [{ role: 'user', content: 'GateLM synthetic private bridge smoke.' }], stream: true },
      { estimatedInputTokens: 16, maxOutputTokens: 64, requestedTier: 'standard', cacheStrategy: 'off' },
      { onDelta: () => { deltaCount += 1; } },
    );
    if (deltaCount < 1 || result.assistantContent.length < 1) {
      throw new Error('Tenant Chat provider stream did not deliver display content.');
    }
    process.stdout.write(`${JSON.stringify({
      status: 'ok',
      requestId: handle.requestId,
      turnId: handle.turnId,
      terminalOutcome: result.final.terminalOutcome,
      usageQuality: result.final.usage.usageQuality,
      surface: 'tenant_chat',
      deltaCount,
      assistantCharacters: result.assistantContent.length,
    })}\n`);
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.name : 'TenantChatSmokeFailed'}\n`);
  process.exitCode = 1;
});
