import { randomBytes } from 'node:crypto';

import { ContentIntegrityError } from './content.errors';
import {
  decryptContent,
  encryptContent,
  newTenantKey,
  unwrapTenantKey,
  wrapTenantKey,
  type ContentAad,
} from './content-crypto';

const aad: ContentAad = {
  schemaVersion: 1,
  tenantId: '10000000-0000-4000-8000-000000000001',
  conversationId: '20000000-0000-4000-8000-000000000001',
  recordId: '30000000-0000-4000-8000-000000000001',
  contentKind: 'message',
  role: 'user',
  contentKeyVersion: 1,
};

describe('Tenant Chat content crypto', () => {
  it('round-trips AES-256-GCM content with canonical record AAD', () => {
    const key = newTenantKey();
    try {
      const encrypted = encryptContent(key, 'synthetic-content', aad);
      expect(decryptContent(key, encrypted, aad)).toBe('synthetic-content');
      expect(encrypted.nonce).toHaveLength(12);
      expect(encrypted.tag).toHaveLength(16);
    } finally {
      key.fill(0);
    }
  });

  it.each([
    ['tenant', { ...aad, tenantId: '10000000-0000-4000-8000-000000000002' }],
    ['conversation', { ...aad, conversationId: '20000000-0000-4000-8000-000000000002' }],
    ['record', { ...aad, recordId: '30000000-0000-4000-8000-000000000002' }],
    ['role', { ...aad, role: 'assistant' as const }],
    ['key version', { ...aad, contentKeyVersion: 2 }],
  ])('fails closed for wrong %s AAD', (_, wrongAad) => {
    const key = newTenantKey();
    try {
      const encrypted = encryptContent(key, 'synthetic-content', aad);
      expect(() => decryptContent(key, encrypted, wrongAad)).toThrow(ContentIntegrityError);
    } finally {
      key.fill(0);
    }
  });

  it('fails closed for wrong key and ciphertext/tag tamper', () => {
    const key = newTenantKey();
    const wrongKey = newTenantKey();
    try {
      const encrypted = encryptContent(key, 'synthetic-content', aad);
      expect(() => decryptContent(wrongKey, encrypted, aad)).toThrow(ContentIntegrityError);
      const ciphertext = Buffer.from(encrypted.ciphertext);
      ciphertext[0] ^= 1;
      expect(() => decryptContent(key, { ...encrypted, ciphertext }, aad)).toThrow(
        ContentIntegrityError,
      );
      const tag = Buffer.from(encrypted.tag);
      tag[0] ^= 1;
      expect(() => decryptContent(key, { ...encrypted, tag }, aad)).toThrow(
        ContentIntegrityError,
      );
    } finally {
      key.fill(0);
      wrongKey.fill(0);
    }
  });

  it('rejects record swaps even when both records use the same tenant key', () => {
    const key = newTenantKey();
    try {
      const otherAad = {
        ...aad,
        recordId: '30000000-0000-4000-8000-000000000002',
        role: 'assistant' as const,
      };
      const first = encryptContent(key, 'first-synthetic-content', aad);
      const second = encryptContent(key, 'second-synthetic-content', otherAad);
      expect(() => decryptContent(key, second, aad)).toThrow(ContentIntegrityError);
      expect(() => decryptContent(key, first, otherAad)).toThrow(ContentIntegrityError);
    } finally {
      key.fill(0);
    }
  });

  it('supports reader-first wrapping-key overlap and rejects rollback/AAD mismatch', () => {
    const tenantKey = newTenantKey();
    const oldWrapping = randomBytes(32);
    const newWrapping = randomBytes(32);
    try {
      const oldEnvelope = wrapTenantKey(tenantKey, oldWrapping, aad.tenantId, 1, 1);
      const oldRead = unwrapTenantKey(oldEnvelope, oldWrapping, aad.tenantId, 1);
      expect(oldRead.equals(tenantKey)).toBe(true);
      oldRead.fill(0);

      const newEnvelope = wrapTenantKey(tenantKey, newWrapping, aad.tenantId, 1, 2);
      const newRead = unwrapTenantKey(newEnvelope, newWrapping, aad.tenantId, 1);
      expect(newRead.equals(tenantKey)).toBe(true);
      newRead.fill(0);

      expect(() => unwrapTenantKey(newEnvelope, oldWrapping, aad.tenantId, 1)).toThrow(
        ContentIntegrityError,
      );
      expect(() => unwrapTenantKey(newEnvelope, newWrapping, aad.tenantId, 2)).toThrow(
        ContentIntegrityError,
      );
    } finally {
      tenantKey.fill(0);
      oldWrapping.fill(0);
      newWrapping.fill(0);
    }
  });

  it('clears temporary key material after unwrap success and authentication failure', () => {
    const tenantKey = newTenantKey();
    const wrappingKey = randomBytes(32);
    const wrongWrappingKey = randomBytes(32);
    const envelope = wrapTenantKey(tenantKey, wrappingKey, aad.tenantId, 1, 1);
    const fillSpy = jest.spyOn(Buffer.prototype, 'fill');
    let unwrapped: Buffer | undefined;

    try {
      unwrapped = unwrapTenantKey(envelope, wrappingKey, aad.tenantId, 1);
      expect(unwrapped.equals(tenantKey)).toBe(true);
      expect(fillSpy).toHaveBeenCalledWith(0);

      fillSpy.mockClear();
      expect(() => unwrapTenantKey(envelope, wrongWrappingKey, aad.tenantId, 1)).toThrow(
        ContentIntegrityError,
      );
      expect(fillSpy).toHaveBeenCalledWith(0);
    } finally {
      fillSpy.mockRestore();
      unwrapped?.fill(0);
      tenantKey.fill(0);
      wrappingKey.fill(0);
      wrongWrappingKey.fill(0);
    }
  });
});
