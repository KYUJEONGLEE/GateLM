import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  parseDataWrappingKeySet,
  type DataWrappingKey,
  type DataWrappingKeySet,
} from '@gatelm/tenant-content-crypto';
import { readFile } from 'node:fs/promises';

import { ContentKeyUnavailable } from './content.errors';

const MAX_KEY_FILE_BYTES = 64 * 1024;
const CONTENT_KEYS_FILE_ENV = 'RAG_CONTENT_WRAPPING_KEYS_FILE';

export type {
  DataWrappingKey as WrappingKey,
  DataWrappingKeySet as WrappingKeySet,
};

@Injectable()
export class RagWrappingKeyProvider {
  private readonly file?: string;

  constructor(config: ConfigService) {
    this.file = config.get<string>(CONTENT_KEYS_FILE_ENV)?.trim() || undefined;
  }

  async isReady(): Promise<boolean> {
    try {
      await this.load();
      return true;
    } catch {
      return false;
    }
  }

  async load(): Promise<DataWrappingKeySet> {
    if (!this.file) throw new ContentKeyUnavailable();

    let bytes: Buffer;
    try {
      bytes = await readFile(this.file);
    } catch {
      throw new ContentKeyUnavailable();
    }

    if (bytes.length < 2 || bytes.length > MAX_KEY_FILE_BYTES) {
      bytes.fill(0);
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

    return parseDataWrappingKeySet(value);
  }
}
