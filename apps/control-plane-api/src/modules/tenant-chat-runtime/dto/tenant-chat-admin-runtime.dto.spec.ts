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
