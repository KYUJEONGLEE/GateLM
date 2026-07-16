export const RAG_EMBEDDING_PROFILE = Object.freeze({
  provider: 'openai',
  model: 'text-embedding-3-large',
  dimensions: 1536,
  profileVersion: 1,
  distanceMetric: 'cosine',
} as const);

export type RawRagEnv = Readonly<Record<string, string | undefined>>;

export type RagRuntimeConfig = Readonly<{
  TENANT_CHAT_RAG_ENABLED: 'true' | 'false';
  RAG_EMBEDDING_PROVIDER: 'openai';
  RAG_EMBEDDING_MODEL: 'text-embedding-3-large';
  RAG_EMBEDDING_DIMENSIONS: 1536;
  RAG_EMBEDDING_PROFILE_VERSION: 1;
  RAG_DISTANCE_METRIC: 'cosine';
}>;

export type RagKnowledgeBaseProfile = Readonly<{
  embeddingProvider: string;
  embeddingModel: string;
  embeddingDimensions: number;
  embeddingProfileVersion: number;
  embeddingDistance: string;
}>;

export class RagEmbeddingProfileMismatchError extends Error {
  constructor() {
    super('RAG knowledge base embedding profile does not match the runtime profile.');
    this.name = 'RagEmbeddingProfileMismatchError';
  }
}

export function validateRagRuntimeConfig(env: RawRagEnv): RagRuntimeConfig {
  return Object.freeze({
    TENANT_CHAT_RAG_ENABLED: booleanString(env, 'TENANT_CHAT_RAG_ENABLED', 'false'),
    RAG_EMBEDDING_PROVIDER: fixedString(
      env,
      'RAG_EMBEDDING_PROVIDER',
      RAG_EMBEDDING_PROFILE.provider,
    ),
    RAG_EMBEDDING_MODEL: fixedString(
      env,
      'RAG_EMBEDDING_MODEL',
      RAG_EMBEDDING_PROFILE.model,
    ),
    RAG_EMBEDDING_DIMENSIONS: fixedInteger(
      env,
      'RAG_EMBEDDING_DIMENSIONS',
      RAG_EMBEDDING_PROFILE.dimensions,
    ),
    RAG_EMBEDDING_PROFILE_VERSION: fixedInteger(
      env,
      'RAG_EMBEDDING_PROFILE_VERSION',
      RAG_EMBEDDING_PROFILE.profileVersion,
    ),
    RAG_DISTANCE_METRIC: fixedString(
      env,
      'RAG_DISTANCE_METRIC',
      RAG_EMBEDDING_PROFILE.distanceMetric,
    ),
  });
}

export function assertRagKnowledgeBaseProfile(profile: RagKnowledgeBaseProfile): void {
  if (
    profile.embeddingProvider !== RAG_EMBEDDING_PROFILE.provider ||
    profile.embeddingModel !== RAG_EMBEDDING_PROFILE.model ||
    profile.embeddingDimensions !== RAG_EMBEDDING_PROFILE.dimensions ||
    profile.embeddingProfileVersion !== RAG_EMBEDDING_PROFILE.profileVersion ||
    profile.embeddingDistance !== RAG_EMBEDDING_PROFILE.distanceMetric
  ) {
    throw new RagEmbeddingProfileMismatchError();
  }
}

export function assertRagKnowledgeBaseProfiles(
  profiles: readonly RagKnowledgeBaseProfile[],
): void {
  for (const profile of profiles) {
    assertRagKnowledgeBaseProfile(profile);
  }
}

export function isTenantRagEnabled(
  globalFlag: 'true' | 'false' | boolean | undefined,
  knowledgeBaseStatus: string | null | undefined,
): boolean {
  return (globalFlag === true || globalFlag === 'true') && knowledgeBaseStatus === 'ENABLED';
}

function booleanString(
  env: RawRagEnv,
  key: string,
  defaultValue: 'true' | 'false',
): 'true' | 'false' {
  const raw = env[key];
  if (raw === undefined) {
    return defaultValue;
  }
  if (raw !== 'true' && raw !== 'false') {
    throw new Error(`${key} must be either "true" or "false".`);
  }
  return raw;
}

function fixedString<T extends string>(env: RawRagEnv, key: string, expected: T): T {
  const raw = env[key];
  const value = raw === undefined ? expected : raw;
  if (value !== expected) {
    throw new Error(`${key} must be ${expected}.`);
  }
  return expected;
}

function fixedInteger<T extends number>(env: RawRagEnv, key: string, expected: T): T {
  const raw = env[key];
  const value = raw === undefined ? expected : Number(raw);
  if (!Number.isInteger(value) || value !== expected) {
    throw new Error(`${key} must be ${expected}.`);
  }
  return expected;
}
