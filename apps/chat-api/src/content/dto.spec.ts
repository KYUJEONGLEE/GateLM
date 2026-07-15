import { ValidationPipe } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { CreateTurnDto } from './dto';

describe('CreateTurnDto contract', () => {
  const pipe = new ValidationPipe({
    forbidNonWhitelisted: true,
    transform: true,
    whitelist: true,
  });

  it('matches the public OpenAPI usage intent and derives no client estimate', async () => {
    const schema = usageIntentSchema();
    const turnSchema = createTurnSchema();
    expect(schema.required).toEqual(['requestedTier', 'maxOutputTokens', 'cacheStrategy']);
    expect(Object.keys(schema.properties).sort()).toEqual([
      'cacheStrategy',
      'maxOutputTokens',
      'requestedTier',
    ]);
    expect(schema.properties.maxOutputTokens.maximum).toBe(8192);
    expect(turnSchema.required).not.toContain('contextMode');
    expect(turnSchema.properties.contextMode).toEqual({
      default: 'conversation',
      description: expect.any(String),
      enum: ['conversation', 'single_turn'],
    });

    await expect(validate({
      idempotencyKey: 'idempotency-key-0001',
      content: '<synthetic>',
      contextMode: 'single_turn',
      usageIntent: {
        requestedTier: 'standard',
        maxOutputTokens: 8192,
        cacheStrategy: 'exact',
      },
    })).resolves.toBeInstanceOf(CreateTurnDto);
  });

  it('rejects a caller-provided estimate and output values above the public maximum', async () => {
    await expect(validate({
      idempotencyKey: 'idempotency-key-0001',
      content: '<synthetic>',
      usageIntent: {
        requestedTier: 'standard',
        maxOutputTokens: 64,
        cacheStrategy: 'exact',
        estimatedInputTokens: 1,
      },
    })).rejects.toMatchObject({ status: 400 });

    await expect(validate({
      idempotencyKey: 'idempotency-key-0001',
      content: '<synthetic>',
      contextMode: 'all_history',
      usageIntent: {
        requestedTier: 'standard',
        maxOutputTokens: 64,
        cacheStrategy: 'exact',
      },
    })).rejects.toMatchObject({ status: 400 });

    await expect(validate({
      idempotencyKey: 'idempotency-key-0001',
      content: '<synthetic>',
      usageIntent: {
        requestedTier: 'standard',
        maxOutputTokens: 8193,
        cacheStrategy: 'exact',
      },
    })).rejects.toMatchObject({ status: 400 });
  });

  function validate(value: unknown) {
    return pipe.transform(value, { type: 'body', metatype: CreateTurnDto });
  }
});

function usageIntentSchema(): Readonly<{
  required: string[];
  properties: Record<string, Readonly<{ maximum?: number }>>;
}> {
  const document = JSON.parse(readFileSync(resolve(
    __dirname,
    '../../../../docs/tenant-chat/openapi/chat-conversation.openapi.json',
  ), 'utf8')) as {
    components: {
      schemas: {
        UsageIntent: {
          required: string[];
          properties: Record<string, Readonly<{ maximum?: number }>>;
        };
      };
    };
  };
  return document.components.schemas.UsageIntent;
}

function createTurnSchema(): Readonly<{
  required: string[];
  properties: Record<string, unknown>;
}> {
  const document = JSON.parse(readFileSync(resolve(
    __dirname,
    '../../../../docs/tenant-chat/openapi/chat-conversation.openapi.json',
  ), 'utf8')) as {
    components: {
      schemas: {
        CreateTurnRequest: {
          required: string[];
          properties: Record<string, unknown>;
        };
      };
    };
  };
  return document.components.schemas.CreateTurnRequest;
}
