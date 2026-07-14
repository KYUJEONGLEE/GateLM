import { ValidationPipe } from '@nestjs/common';

import { UpsertRuntimeConfigDraftDto } from './runtime-config.dto';

const providerId = '00000000-0000-4000-8000-000000000600';

function routes(modelRef: string) {
  return {
    general: {
      simple: { modelRefs: [modelRef] },
      complex: { modelRefs: [modelRef] },
    },
    code: {
      simple: { modelRefs: [modelRef] },
      complex: { modelRefs: [modelRef] },
    },
    translation: {
      simple: { modelRefs: [modelRef] },
      complex: { modelRefs: [modelRef] },
    },
    summarization: {
      simple: { modelRefs: [modelRef] },
      complex: { modelRefs: [modelRef] },
    },
    reasoning: {
      simple: { modelRefs: [modelRef] },
      complex: { modelRefs: [modelRef] },
    },
  };
}

describe('UpsertRuntimeConfigDraftDto routing policy v2', () => {
  const validationPipe = new ValidationPipe({
    forbidNonWhitelisted: true,
    transform: true,
    whitelist: true,
  });

  it('accepts the complete category by difficulty matrix', async () => {
    const payload = {
      routingPolicy: {
        mode: 'auto',
        routes: routes(`${providerId}:mock-balanced`),
      },
    };

    await expect(
      validationPipe.transform(payload, {
        type: 'body',
        metatype: UpsertRuntimeConfigDraftDto,
      }),
    ).resolves.toEqual(payload);
  });

  it('accepts model context windows up to 10M tokens', async () => {
    const payload = {
      models: [
        {
          provider: 'gemini',
          model: 'large-context-model',
          contextWindowTokens: 10_000_000,
        },
      ],
    };

    await expect(
      validationPipe.transform(payload, {
        type: 'body',
        metatype: UpsertRuntimeConfigDraftDto,
      }),
    ).resolves.toEqual(payload);
  });

  it('rejects model context windows above 10M tokens', async () => {
    await expect(
      validationPipe.transform(
        {
          models: [
            {
              provider: 'gemini',
              model: 'oversized-context-model',
              contextWindowTokens: 10_000_001,
            },
          ],
        },
        {
          type: 'body',
          metatype: UpsertRuntimeConfigDraftDto,
        },
      ),
    ).rejects.toThrow('Bad Request Exception');
  });

  it('rejects more than one fallback candidate in a route cell', async () => {
    const routingRoutes = routes(`${providerId}:mock-balanced`);
    routingRoutes.general.simple.modelRefs = [
      `${providerId}:mock-balanced`,
      `${providerId}:mock-fallback`,
      `${providerId}:mock-last`,
    ];

    await expect(
      validationPipe.transform(
        {
          routingPolicy: {
            mode: 'auto',
            routes: routingRoutes,
          },
        },
        {
          type: 'body',
          metatype: UpsertRuntimeConfigDraftDto,
        },
      ),
    ).rejects.toThrow('Bad Request Exception');
  });

  it('rejects legacy tier model fields instead of accepting a v1 bridge', async () => {
    await expect(
      validationPipe.transform(
        {
          routingPolicy: {
            defaultProvider: 'mock',
            defaultModel: 'mock-balanced',
            lowCostProvider: 'mock',
            lowCostModel: 'mock-fast',
            highQualityProvider: 'mock',
            highQualityModel: 'mock-smart',
            fallbackProvider: 'mock',
            fallbackModel: 'mock-fallback',
          },
        },
        {
          type: 'body',
          metatype: UpsertRuntimeConfigDraftDto,
        },
      ),
    ).rejects.toThrow('Bad Request Exception');
  });

  it('rejects server-derived routing fields from the draft input', async () => {
    await expect(
      validationPipe.transform(
        {
          routingPolicy: {
            mode: 'auto',
            bootstrapState: 'configured',
            routingPolicyHash:
              'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            routes: routes(`${providerId}:mock-balanced`),
          },
        },
        {
          type: 'body',
          metatype: UpsertRuntimeConfigDraftDto,
        },
      ),
    ).rejects.toThrow('Bad Request Exception');
  });

  it('rejects the legacy high-quality budget switch', async () => {
    await expect(
      validationPipe.transform(
        {
          budgetPolicy: {
            enabled: true,
            enforcementMode: 'warn',
            warningThresholdPercent: 80,
            restrictHighQualityOnBudgetRisk: true,
          },
        },
        {
          type: 'body',
          metatype: UpsertRuntimeConfigDraftDto,
        },
      ),
    ).rejects.toThrow('Bad Request Exception');
  });
});
