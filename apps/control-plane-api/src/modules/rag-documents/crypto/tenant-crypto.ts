import * as tenantCrypto from '@gatelm/tenant-content-crypto';

export const canonicalizeJson = tenantCrypto.canonicalizeJson;
export const createRagDocumentPrivateMetadataAadV1 =
  tenantCrypto.createRagDocumentPrivateMetadataAadV1;
export const createRagChunkAadV1 = tenantCrypto.createRagChunkAadV1;
export const decryptContent = tenantCrypto.decryptContent;
export const encryptContent = tenantCrypto.encryptContent;
export const newTenantKey = tenantCrypto.newTenantKey;
export const unwrapTenantKey = tenantCrypto.unwrapTenantKey;
export const wrapTenantKey = tenantCrypto.wrapTenantKey;

export type EncryptedPayload = tenantCrypto.EncryptedPayload;
export type TenantKeyResolver = tenantCrypto.TenantKeyResolver;
export type WrappingKeySet = tenantCrypto.WrappingKeySet;
