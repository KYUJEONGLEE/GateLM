import { Injectable } from '@nestjs/common';

import type { JsonValue } from '@/execution/jcs';

import { ContentIntegrityService } from './content-integrity.service';

const MAX_CURSOR_BYTES = 2048;

export class InvalidCursor extends Error {
  constructor() {
    super('Tenant Chat cursor is invalid.');
    this.name = 'InvalidCursor';
  }
}

@Injectable()
export class CursorCodec {
  constructor(private readonly integrity: ContentIntegrityService) {}

  async encode(value: JsonValue): Promise<string> {
    const payload = Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
    const signed = await this.integrity.sign(value);
    const cursor = `${payload}.${signed.keyVersion}.${signed.mac.slice('hmac-sha256:'.length)}`;
    if (Buffer.byteLength(cursor) > MAX_CURSOR_BYTES) throw new InvalidCursor();
    return cursor;
  }

  async decode(cursor: string): Promise<JsonValue> {
    if (
      typeof cursor !== 'string' ||
      cursor.length < 32 ||
      Buffer.byteLength(cursor) > MAX_CURSOR_BYTES ||
      !/^[A-Za-z0-9_.-]+$/.test(cursor)
    ) {
      throw new InvalidCursor();
    }
    const parts = cursor.split('.');
    if (parts.length !== 3 || !/^[1-9][0-9]{0,9}$/.test(parts[1]) || !/^[A-Za-z0-9_-]{43}$/.test(parts[2])) {
      throw new InvalidCursor();
    }
    let value: unknown;
    try {
      const decoded = Buffer.from(parts[0], 'base64url');
      if (decoded.toString('base64url') !== parts[0]) throw new InvalidCursor();
      value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(decoded));
    } catch {
      throw new InvalidCursor();
    }
    if (!jsonValue(value)) throw new InvalidCursor();
    try {
      await this.integrity.verify(value, Number(parts[1]), `hmac-sha256:${parts[2]}`);
    } catch {
      throw new InvalidCursor();
    }
    return value;
  }
}

function jsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(jsonValue);
  if (!value || typeof value !== 'object') return false;
  return Object.values(value as Record<string, unknown>).every(jsonValue);
}
