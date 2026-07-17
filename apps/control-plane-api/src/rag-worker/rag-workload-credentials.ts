import { Injectable } from '@nestjs/common';
import { createPrivateKey, createPublicKey, type KeyObject } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { RagWorkerSettings } from './rag-worker-settings';
import { RagWorkerError } from './rag-worker.types';

type Credentials = Readonly<{ kid: string; privateKey: KeyObject; bindingKey: Buffer }>;

type PrivateJwk = Readonly<{
  kty: 'OKP';
  crv: 'Ed25519';
  alg: 'EdDSA';
  use: 'sig';
  kid: string;
  x: string;
  d: string;
}>;

@Injectable()
export class RagWorkloadCredentials {
  private cached?: Promise<Credentials>;

  constructor(private readonly settings: RagWorkerSettings) {}

  load(): Promise<Credentials> {
    if (this.cached) return this.cached;
    const pending = this.loadUnchecked().catch(() => {
      if (this.cached === pending) this.cached = undefined;
      throw new RagWorkerError(
        'RAG_WORKER_AUTH_UNAVAILABLE',
        'RAG worker workload credentials are unavailable.',
        false,
      );
    });
    this.cached = pending;
    return pending;
  }

  private async loadUnchecked(): Promise<Credentials> {
    const { workloadActiveKid: kid, workloadSigningJwkFile, bindingHmacKeysFile } = this.settings.value;
    const [privateDocument, bindingDocument] = await Promise.all([
      readJson(workloadSigningJwkFile),
      readJson(bindingHmacKeysFile),
    ]);
    const jwk = parsePrivateJwk(privateDocument, kid);
    const privateKey = createPrivateKey({ key: jwk, format: 'jwk' });
    const publicJwk = createPublicKey(privateKey).export({ format: 'jwk' });
    if (publicJwk.kty !== 'OKP' || publicJwk.crv !== 'Ed25519' || publicJwk.x !== jwk.x) {
      throw new Error('private key does not match public material');
    }
    return Object.freeze({ kid, privateKey, bindingKey: parseBindingKey(bindingDocument, kid) });
  }
}

async function readJson(path: string): Promise<unknown> {
  const value = await readFile(path, 'utf8');
  if (Buffer.byteLength(value, 'utf8') > 64 * 1024) throw new Error('credential document too large');
  return JSON.parse(value) as unknown;
}

function parsePrivateJwk(value: unknown, kid: string): PrivateJwk {
  const record = exactRecord(value, ['alg', 'crv', 'd', 'kid', 'kty', 'use', 'x']);
  if (
    record.kty !== 'OKP' || record.crv !== 'Ed25519' || record.alg !== 'EdDSA' ||
    record.use !== 'sig' || record.kid !== kid || typeof record.x !== 'string' ||
    typeof record.d !== 'string' || decodeBase64Url(record.x).length !== 32 ||
    decodeBase64Url(record.d).length !== 32
  ) throw new Error('invalid private JWK');
  return record as PrivateJwk;
}

function parseBindingKey(value: unknown, activeKid: string): Buffer {
  const document = exactRecord(value, ['keys']);
  if (!Array.isArray(document.keys) || document.keys.length < 1) throw new Error('missing binding key');
  let selected: Buffer | undefined;
  const seen = new Set<string>();
  for (const item of document.keys) {
    const record = exactRecord(item, ['key', 'kid']);
    if (typeof record.kid !== 'string' || typeof record.key !== 'string' || seen.has(record.kid)) {
      throw new Error('invalid binding key');
    }
    seen.add(record.kid);
    const material = decodeBase64Url(record.key);
    if (material.length !== 32) throw new Error('invalid binding key');
    if (record.kid === activeKid) selected = material;
  }
  if (!selected) throw new Error('active binding key missing');
  return selected;
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('object required');
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record).sort();
  if (actual.length !== keys.length || actual.some((key, index) => key !== keys[index])) {
    throw new Error('invalid object shape');
  }
  return record;
}

function decodeBase64Url(value: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('invalid base64url');
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.toString('base64url') !== value) throw new Error('noncanonical base64url');
  return decoded;
}
