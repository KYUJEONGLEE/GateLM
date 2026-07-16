import * as tenantCrypto from '@gatelm/tenant-content-crypto';

export const createMessageAad = tenantCrypto.createMessageAad;
export const createMessageCitationsAad = tenantCrypto.createMessageCitationsAad;
export const createRagChunkAadV1 = tenantCrypto.createRagChunkAadV1;
export const createRagDocumentPrivateMetadataAadV1 =
  tenantCrypto.createRagDocumentPrivateMetadataAadV1;
export const createTitleAad = tenantCrypto.createTitleAad;
export const decryptContent = tenantCrypto.decryptContent;
export const encryptContent = tenantCrypto.encryptContent;
export const newTenantKey = tenantCrypto.newTenantKey;
export const unwrapTenantKey = tenantCrypto.unwrapTenantKey;
export const wrapTenantKey = tenantCrypto.wrapTenantKey;

export type ContentAad = tenantCrypto.ContentAad;
export type ContentKind = tenantCrypto.ContentKind;
export type ContentRole = tenantCrypto.ContentRole;
export type EncryptedContent = tenantCrypto.EncryptedContent;
export type WrappedTenantKey = tenantCrypto.WrappedTenantKey;
