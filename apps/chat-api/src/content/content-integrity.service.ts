import { Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';

import { canonicalizeJson, type JsonValue } from '@/execution/jcs';

import { ContentIntegrityError, ContentKeyUnavailable } from './content.errors';
import { WrappingKeyProvider } from './wrapping-key-provider';

const MAC_PATTERN = /^hmac-sha256:[A-Za-z0-9_-]{43}$/;

@Injectable()
export class ContentIntegrityService {
  constructor(private readonly keys: WrappingKeyProvider) {}

  async sign(value: JsonValue): Promise<Readonly<{ keyVersion: number; mac: string }>> {
    const keySet = await this.keys.load();
    const key = keySet.keys.get(keySet.activeVersion);
    if (!key) throw new ContentKeyUnavailable();
    return Object.freeze({
      keyVersion: key.version,
      mac: mac(key.integrityKey, canonicalizeJson(value)),
    });
  }

  async verify(value: JsonValue, keyVersion: number, expected: string): Promise<void> {
    if (!Number.isInteger(keyVersion) || keyVersion < 1 || !MAC_PATTERN.test(expected)) {
      throw new ContentIntegrityError();
    }
    const keySet = await this.keys.load();
    const key = keySet.keys.get(keyVersion);
    if (!key) throw new ContentKeyUnavailable();
    const actual = mac(key.integrityKey, canonicalizeJson(value));
    const left = Buffer.from(actual);
    const right = Buffer.from(expected);
    try {
      if (left.length !== right.length || !timingSafeEqual(left, right)) {
        throw new ContentIntegrityError();
      }
    } finally {
      left.fill(0);
      right.fill(0);
    }
  }
}

function mac(key: Buffer, canonical: string): string {
  return `hmac-sha256:${createHmac('sha256', key).update(canonical, 'utf8').digest('base64url')}`;
}
