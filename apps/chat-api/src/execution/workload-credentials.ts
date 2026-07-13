import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPrivateKey, createPublicKey, type KeyObject } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const OPAQUE_ID = /^[A-Za-z0-9_-]{1,128}$/;

export class ExecutionConfigurationUnavailable extends Error {
  constructor() {
    super('Tenant Chat execution configuration is unavailable.');
    this.name = 'ExecutionConfigurationUnavailable';
  }
}

export type WorkloadCredentials = Readonly<{
  kid: string;
  privateKey: KeyObject;
  bindingKey: Buffer;
}>;

type PrivateJwk = {
  kty: 'OKP';
  crv: 'Ed25519';
  alg: 'EdDSA';
  use: 'sig';
  kid: string;
  x: string;
  d: string;
};

@Injectable()
export class WorkloadCredentialsService {
  private readonly activeKid?: string;
  private readonly privateJwkFile?: string;
  private readonly bindingKeysFile?: string;

  constructor(config: ConfigService) {
    this.activeKid = config.get<string>('TENANT_CHAT_WORKLOAD_ACTIVE_KID')?.trim() || undefined;
    this.privateJwkFile = config.get<string>('TENANT_CHAT_WORKLOAD_SIGNING_JWK_FILE')?.trim() || undefined;
    this.bindingKeysFile = config.get<string>('TENANT_CHAT_BINDING_HMAC_KEYS_FILE')?.trim() || undefined;
  }

  async isReady(): Promise<boolean> {
    try {
      await this.load();
      return true;
    } catch {
      return false;
    }
  }

  async load(): Promise<WorkloadCredentials> {
    try {
      if (!this.activeKid || !OPAQUE_ID.test(this.activeKid) || !this.privateJwkFile || !this.bindingKeysFile) {
        throw new Error('missing execution credential setting');
      }
      const [privateDocument, bindingDocument] = await Promise.all([
        readStrictJson(this.privateJwkFile),
        readStrictJson(this.bindingKeysFile),
      ]);
      const jwk = parsePrivateJwk(privateDocument, this.activeKid);
      const bindingKey = parseBindingKey(bindingDocument, this.activeKid);
      const privateKey = createPrivateKey({ key: jwk, format: 'jwk' });
      const derived = createPublicKey(privateKey).export({ format: 'jwk' });
      if (derived.kty !== 'OKP' || derived.crv !== 'Ed25519' || derived.x !== jwk.x) {
        throw new Error('private and public Ed25519 material do not match');
      }
      return Object.freeze({ kid: this.activeKid, privateKey, bindingKey });
    } catch {
      throw new ExecutionConfigurationUnavailable();
    }
  }
}

async function readStrictJson(path: string): Promise<unknown> {
  const raw = await readFile(path, { encoding: 'utf8' });
  if (Buffer.byteLength(raw) > 64 * 1024) throw new Error('credential file is too large');
  return JSON.parse(raw) as unknown;
}

function parsePrivateJwk(value: unknown, activeKid: string): PrivateJwk {
  const record = strictRecord(value, ['alg', 'crv', 'd', 'kid', 'kty', 'use', 'x']);
  if (
    record.kty !== 'OKP' ||
    record.crv !== 'Ed25519' ||
    record.alg !== 'EdDSA' ||
    record.use !== 'sig' ||
    record.kid !== activeKid ||
    typeof record.x !== 'string' ||
    typeof record.d !== 'string' ||
    decodeBase64Url(record.x).length !== 32 ||
    decodeBase64Url(record.d).length !== 32
  ) {
    throw new Error('private JWK is invalid');
  }
  return record as PrivateJwk;
}

function parseBindingKey(value: unknown, activeKid: string): Buffer {
  const document = strictRecord(value, ['keys']);
  if (!Array.isArray(document.keys) || document.keys.length === 0) {
    throw new Error('binding keys are missing');
  }
  const seen = new Set<string>();
  let selected: Buffer | undefined;
  for (const entry of document.keys) {
    const record = strictRecord(entry, ['key', 'kid']);
    if (typeof record.kid !== 'string' || !OPAQUE_ID.test(record.kid) || seen.has(record.kid)) {
      throw new Error('binding key kid is invalid');
    }
    seen.add(record.kid);
    if (typeof record.key !== 'string') throw new Error('binding key material is invalid');
    const key = decodeBase64Url(record.key);
    if (key.length !== 32) throw new Error('binding key material is invalid');
    if (record.kid === activeKid) selected = key;
  }
  if (!selected) throw new Error('active binding key is missing');
  return selected;
}

function strictRecord(value: unknown, expectedKeys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('JSON object required');
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) {
    throw new Error('JSON object shape is invalid');
  }
  return record;
}

function decodeBase64Url(value: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('base64url value is invalid');
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.toString('base64url') !== value) throw new Error('base64url value is not canonical');
  return decoded;
}
