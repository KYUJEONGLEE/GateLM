import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFile } from 'node:fs/promises';

import { ContentKeyUnavailable } from './content.errors';

const MAX_KEY_FILE_BYTES = 64 * 1024;
const KEY_BYTES = 32;

export type WrappingKey = Readonly<{
  version: number;
  wrappingKey: Buffer;
  integrityKey: Buffer;
}>;

export type WrappingKeySet = Readonly<{
  activeVersion: number;
  keys: ReadonlyMap<number, WrappingKey>;
}>;

@Injectable()
export class WrappingKeyProvider {
  private readonly file?: string;

  constructor(config: ConfigService) {
    this.file = config.get<string>('TENANT_CHAT_CONTENT_KEYS_FILE')?.trim() || undefined;
  }

  async isReady(): Promise<boolean> {
    try {
      await this.load();
      return true;
    } catch {
      return false;
    }
  }

  async load(): Promise<WrappingKeySet> {
    if (!this.file) throw new ContentKeyUnavailable();
    let bytes: Buffer;
    try {
      bytes = await readFile(this.file);
    } catch {
      throw new ContentKeyUnavailable();
    }
    if (bytes.length < 2 || bytes.length > MAX_KEY_FILE_BYTES) {
      throw new ContentKeyUnavailable();
    }
    let value: unknown;
    try {
      value = JSON.parse(bytes.toString('utf8'));
    } catch {
      throw new ContentKeyUnavailable();
    } finally {
      bytes.fill(0);
    }
    return parseKeySet(value);
  }
}

function parseKeySet(value: unknown): WrappingKeySet {
  if (!exactObject(value, ['activeVersion', 'keys', 'schemaVersion'])) {
    throw new ContentKeyUnavailable();
  }
  if (value.schemaVersion !== 1 || !positiveInteger(value.activeVersion) || !Array.isArray(value.keys)) {
    throw new ContentKeyUnavailable();
  }
  if (value.keys.length < 1 || value.keys.length > 8) throw new ContentKeyUnavailable();

  const keys = new Map<number, WrappingKey>();
  for (const candidate of value.keys) {
    if (!exactObject(candidate, ['integrityKey', 'version', 'wrappingKey'])) {
      throw new ContentKeyUnavailable();
    }
    if (
      !positiveInteger(candidate.version) ||
      typeof candidate.wrappingKey !== 'string' ||
      typeof candidate.integrityKey !== 'string' ||
      keys.has(candidate.version)
    ) {
      throw new ContentKeyUnavailable();
    }
    const wrappingKey = decodeKey(candidate.wrappingKey);
    const integrityKey = decodeKey(candidate.integrityKey);
    keys.set(candidate.version, Object.freeze({ version: candidate.version, wrappingKey, integrityKey }));
  }
  if (!keys.has(value.activeVersion)) throw new ContentKeyUnavailable();
  return Object.freeze({ activeVersion: value.activeVersion, keys });
}

function decodeKey(value: string): Buffer {
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) throw new ContentKeyUnavailable();
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.length !== KEY_BYTES || decoded.toString('base64url') !== value) {
    decoded.fill(0);
    throw new ContentKeyUnavailable();
  }
  return decoded;
}

function exactObject(value: unknown, expected: string[]): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return keys.length === wanted.length && keys.every((key, index) => key === wanted[index]);
}

function positiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 2_147_483_647;
}
