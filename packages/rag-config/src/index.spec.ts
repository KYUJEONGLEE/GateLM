import {
  RAG_EMBEDDING_PROFILE,
  RagEmbeddingProfileMismatchError,
  assertRagKnowledgeBaseProfile,
  isTenantRagEnabled,
  validateRagRuntimeConfig,
} from './index';

const profile = Object.freeze({
  embeddingProvider: RAG_EMBEDDING_PROFILE.provider,
  embeddingModel: RAG_EMBEDDING_PROFILE.model,
  embeddingDimensions: RAG_EMBEDDING_PROFILE.dimensions,
  embeddingProfileVersion: RAG_EMBEDDING_PROFILE.profileVersion,
  embeddingDistance: RAG_EMBEDDING_PROFILE.distanceMetric,
});

describe('RAG runtime configuration', () => {
  it('defaults the global feature flag to disabled and fixes profile v1', () => {
    expect(validateRagRuntimeConfig({})).toEqual({
      TENANT_CHAT_RAG_ENABLED: 'false',
      RAG_EMBEDDING_PROVIDER: 'openai',
      RAG_EMBEDDING_MODEL: 'text-embedding-3-large',
      RAG_EMBEDDING_DIMENSIONS: 1536,
      RAG_EMBEDDING_PROFILE_VERSION: 1,
      RAG_DISTANCE_METRIC: 'cosine',
    });
  });

  it.each([
    ['TENANT_CHAT_RAG_ENABLED', 'yes'],
    ['RAG_EMBEDDING_PROVIDER', 'other'],
    ['RAG_EMBEDDING_MODEL', 'text-embedding-3-small'],
    ['RAG_EMBEDDING_DIMENSIONS', '3072'],
    ['RAG_EMBEDDING_PROFILE_VERSION', '2'],
    ['RAG_DISTANCE_METRIC', 'euclidean'],
  ])('rejects unsupported %s', (key, value) => {
    expect(() => validateRagRuntimeConfig({ [key]: value })).toThrow(key);
  });

  it.each([
    'TENANT_CHAT_RAG_ENABLED',
    'RAG_EMBEDDING_PROVIDER',
    'RAG_EMBEDDING_MODEL',
    'RAG_EMBEDDING_DIMENSIONS',
    'RAG_EMBEDDING_PROFILE_VERSION',
    'RAG_DISTANCE_METRIC',
  ])('rejects an explicitly empty %s', (key) => {
    expect(() => validateRagRuntimeConfig({ [key]: '' })).toThrow(key);
  });

  it('accepts only the fixed database profile', () => {
    expect(() => assertRagKnowledgeBaseProfile(profile)).not.toThrow();
    expect(() =>
      assertRagKnowledgeBaseProfile({ ...profile, embeddingDimensions: 3072 }),
    ).toThrow(RagEmbeddingProfileMismatchError);
  });

  it('requires both global and tenant-level feature flags', () => {
    expect(isTenantRagEnabled('false', 'ENABLED')).toBe(false);
    expect(isTenantRagEnabled('true', 'DISABLED')).toBe(false);
    expect(isTenantRagEnabled('true', 'ENABLED')).toBe(true);
    expect(isTenantRagEnabled('true', 'UNKNOWN')).toBe(false);
  });
});
