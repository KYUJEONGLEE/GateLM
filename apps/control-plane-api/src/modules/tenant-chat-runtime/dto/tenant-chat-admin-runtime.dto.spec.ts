import { ValidationPipe } from '@nestjs/common';

import { ActivateTenantChatRuntimeDto } from './tenant-chat-admin-runtime.dto';

describe('ActivateTenantChatRuntimeDto', () => {
  const pipe = new ValidationPipe({
    forbidNonWhitelisted: true,
    transform: true,
    whitelist: true,
  });
  const providerConnectionId = '00000000-0000-4000-8000-000000000601';

  it.each(['gpt-5.4-mini', 'models/gemini-2.5-flash', 'vendor:model.v1'])(
    'accepts exact catalog model key %s',
    async (modelKey) => {
      await expect(
        pipe.transform(
          { providerConnectionId, modelKey },
          { type: 'body', metatype: ActivateTenantChatRuntimeDto },
        ),
      ).resolves.toMatchObject({ providerConnectionId, modelKey });
    },
  );

  it.each(['model key', 'model\nkey', `m${'x'.repeat(200)}`])(
    'rejects invalid model key %p',
    async (modelKey) => {
      await expect(
        pipe.transform(
          { providerConnectionId, modelKey },
          { type: 'body', metatype: ActivateTenantChatRuntimeDto },
        ),
      ).rejects.toThrow();
    },
  );

  it('rejects client-supplied publisher or policy fields', async () => {
    await expect(
      pipe.transform(
        { providerConnectionId, modelKey: 'gpt-5.4-mini', publishedBy: 'client' },
        { type: 'body', metatype: ActivateTenantChatRuntimeDto },
      ),
    ).rejects.toThrow();
  });

  it('accepts bounded cache and safety policy fields', async () => {
    await expect(
      pipe.transform(
        {
          providerConnectionId,
          modelKey: 'gpt-5.4-mini',
          cachePolicy: {
            enabled: true,
            ttlSeconds: 300,
            maxEntriesPerUser: 100,
          },
          safetyPolicy: {
            detectorSet: [
              { detectorType: 'email', action: 'allow' },
              { detectorType: 'api_key', action: 'block' },
            ],
          },
        },
        { type: 'body', metatype: ActivateTenantChatRuntimeDto },
      ),
    ).resolves.toMatchObject({
      cachePolicy: { enabled: true, ttlSeconds: 300, maxEntriesPerUser: 100 },
      safetyPolicy: {
        detectorSet: [
          { detectorType: 'email', action: 'allow' },
          { detectorType: 'api_key', action: 'block' },
        ],
      },
    });
  });

  it('accepts a non-negative global monthly token limit', async () => {
    await expect(
      pipe.transform(
        {
          quota: {
            defaultMonthlyTokenLimit: 0,
            timezone: 'Asia/Seoul',
            warningPercent: 80,
            economyPercent: 90,
            hardStopPercent: 100,
          },
        },
        { type: 'body', metatype: ActivateTenantChatRuntimeDto },
      ),
    ).resolves.toMatchObject({
      quota: {
        defaultMonthlyTokenLimit: 0,
        timezone: 'Asia/Seoul',
        warningPercent: 80,
        economyPercent: 90,
        hardStopPercent: 100,
      },
    });
  });

  it('accepts the complete degraded-runtime recovery payload used by Chat App', async () => {
    const modelRef = 'tc_3ab364b76fff7eab19032f7bb29e70dc';
    const cell = () => ({ modelRefs: [modelRef] });

    await expect(
      pipe.transform(
        {
          cachePolicy: {
            enabled: true,
            ttlSeconds: 300,
            maxEntriesPerUser: 100,
          },
          manualModelRef: modelRef,
          quota: {
            defaultMonthlyTokenLimit: 1_000_000,
            timezone: 'Asia/Seoul',
            warningPercent: 80,
            economyPercent: 90,
            hardStopPercent: 100,
          },
          routes: {
            general: { simple: cell(), complex: cell() },
            code: { simple: cell(), complex: cell() },
            translation: { simple: cell(), complex: cell() },
            summarization: { simple: cell(), complex: cell() },
            reasoning: { simple: cell(), complex: cell() },
          },
          routingMode: 'auto',
          safetyPolicy: {
            detectorSet: [
              { detectorType: 'email', action: 'redact' },
              { detectorType: 'phone_number', action: 'redact' },
              { detectorType: 'person_name', action: 'redact' },
              { detectorType: 'postal_address', action: 'redact' },
              { detectorType: 'organization_name', action: 'redact' },
              { detectorType: 'resident_registration_number', action: 'block' },
              { detectorType: 'api_key', action: 'block' },
              { detectorType: 'authorization_header', action: 'block' },
              { detectorType: 'jwt', action: 'block' },
              { detectorType: 'private_key', action: 'block' },
            ],
          },
        },
        { type: 'body', metatype: ActivateTenantChatRuntimeDto },
      ),
    ).resolves.toMatchObject({
      manualModelRef: modelRef,
      routingMode: 'auto',
    });
  });

  it('rejects duplicate safety detectors and invalid cache values', async () => {
    await expect(
      pipe.transform(
        {
          cachePolicy: {
            enabled: true,
            ttlSeconds: 0,
            maxEntriesPerUser: 100,
          },
          safetyPolicy: {
            detectorSet: [
              { detectorType: 'email', action: 'redact' },
              { detectorType: 'email', action: 'block' },
            ],
          },
        },
        { type: 'body', metatype: ActivateTenantChatRuntimeDto },
      ),
    ).rejects.toThrow();
  });

  it('accepts only a boolean compatibility cache toggle', async () => {
    await expect(
      pipe.transform(
        { providerConnectionId, modelKey: 'gpt-5.4-mini', cacheEnabled: false },
        { type: 'body', metatype: ActivateTenantChatRuntimeDto },
      ),
    ).resolves.toMatchObject({ cacheEnabled: false });

    await expect(
      pipe.transform(
        { providerConnectionId, modelKey: 'gpt-5.4-mini', cacheEnabled: 'false' },
        { type: 'body', metatype: ActivateTenantChatRuntimeDto },
      ),
    ).rejects.toThrow();
  });
});
