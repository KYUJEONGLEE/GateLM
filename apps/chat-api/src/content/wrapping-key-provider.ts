import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  parseWrappingKeySet,
  type WrappingKey,
  type WrappingKeySet,
} from '@gatelm/tenant-content-crypto';
import { readFile } from 'node:fs/promises';

import { ContentKeyUnavailable } from './content.errors';

const MAX_KEY_FILE_BYTES = 64 * 1024;
export type { WrappingKey, WrappingKeySet };

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
    return parseWrappingKeySet(value);
  }
}
