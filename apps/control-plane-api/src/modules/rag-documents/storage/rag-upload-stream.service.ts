import { createHash, type Hash } from 'node:crypto';
import { Readable, Transform, type TransformCallback } from 'node:stream';
import { TextDecoder } from 'node:util';

import { Inject, Injectable, Logger } from '@nestjs/common';
import busboy = require('busboy');
import type { Request } from 'express';

import {
  RAG_OBJECT_STORE,
  type RagObjectStore,
  type RagSourceMimeType,
} from './object-store.port';
import { assertRagSourceObjectKey } from './rag-object-key';
import { RagUploadException } from './rag-upload.errors';

const FILE_FIELD = 'file';
const DISPLAY_NAME_FIELD = 'displayName';
const MAX_DISPLAY_NAME_CHARACTERS = 255;
const MAX_DISPLAY_NAME_BYTES = 1_024;
const MAX_FILENAME_BYTES = 255;
const MAX_MULTIPART_FIELD_BYTES = 1_024;
const MAX_MULTIPART_OVERHEAD_BYTES = 64 * 1_024;
const UPLOAD_IDLE_TIMEOUT_MS = 30_000;
const PDF_SIGNATURE_BYTES = 5;
const SNIFF_PREFIX_BYTES = 8;
const PDF_SIGNATURE = Buffer.from('%PDF-', 'ascii');
const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;

export interface RagMultipartUploadOptions {
  maxBytes: number;
  objectKey: string;
  operationId?: string;
}

export interface ParsedRagUpload {
  displayName?: string;
  fileExtension: 'pdf' | 'txt';
  mimeType: RagSourceMimeType;
  originalFilename: string;
  sha256Digest: string;
  sizeBytes: number;
}

interface AcceptedFileInfo {
  fileExtension: ParsedRagUpload['fileExtension'];
  mimeType: RagSourceMimeType;
  originalFilename: string;
}

interface ValidatedStreamResult {
  sha256Digest: string;
  sizeBytes: number;
}

@Injectable()
export class RagUploadStreamService {
  private readonly logger = new Logger(RagUploadStreamService.name);

  constructor(
    @Inject(RAG_OBJECT_STORE)
    private readonly objectStore: RagObjectStore,
  ) {}

  parseAndUpload(
    request: Request,
    options: RagMultipartUploadOptions,
  ): Promise<ParsedRagUpload> {
    this.validateOptions(options);
    const maxRequestBytes = options.maxBytes + MAX_MULTIPART_OVERHEAD_BYTES;
    try {
      assertContentLengthWithinLimit(request, maxRequestBytes);
    } catch (error) {
      return Promise.reject(toRagUploadException(error));
    }

    let parser: busboy.Busboy;
    try {
      parser = busboy({
        defParamCharset: 'utf8',
        headers: request.headers,
        limits: {
          fieldNameSize: 100,
          fieldSize: MAX_MULTIPART_FIELD_BYTES,
          fields: 1,
          // Busboy marks a stream truncated as soon as it reaches its limit.
          // Permit one sentinel byte so an exact maxBytes file remains valid;
          // the transform rejects that sentinel before forwarding it.
          fileSize: options.maxBytes + 1,
          files: 1,
          headerPairs: 100,
          // Busboy emits partsLimit when the configured count is reached, so
          // three means the supported file + optional field can complete while
          // any third part is still rejected by the field/file limits below.
          parts: 3,
        },
        preservePath: true,
      });
    } catch {
      return Promise.reject(
        new RagUploadException('RAG_UPLOAD_MULTIPART_INVALID'),
      );
    }

    return new Promise<ParsedRagUpload>((resolve, reject) => {
      const uploadAbortController = new AbortController();
      let acceptedFile: AcceptedFileInfo | undefined;
      let completionStarted = false;
      let displayName: string | undefined;
      let failureStarted = false;
      let fileSeen = false;
      let fileStream: Readable | undefined;
      let parserClosed = false;
      let streamValidator: RagSourceValidationTransform | undefined;
      let streamResult: ValidatedStreamResult | undefined;
      let uploadTask: Promise<void> | undefined;
      let idleTimer: ReturnType<typeof setTimeout>;
      let requestLimiter: MultipartRequestLimitTransform;

      const resetIdleTimer = (): void => {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          fail(new RagUploadException('RAG_UPLOAD_ABORTED'));
        }, UPLOAD_IDLE_TIMEOUT_MS);
      };

      requestLimiter = new MultipartRequestLimitTransform(
        maxRequestBytes,
        resetIdleTimer,
      );

      const removeRequestListeners = (): void => {
        clearTimeout(idleTimer);
        request.off('aborted', onRequestAborted);
        request.off('error', onRequestError);
      };

      const stopReadingMultipart = (): void => {
        // A final multipart chunk can reach the limiter after fail() clears the
        // current deadline but before this deferred teardown runs. Clear it
        // again here so rejected requests never leave an idle timer behind.
        clearTimeout(idleTimer);
        request.unpipe(requestLimiter);
        requestLimiter.unpipe(parser);
        fileStream?.unpipe(streamValidator);
        fileStream?.resume();
        if (streamValidator && !streamValidator.destroyed) {
          streamValidator.destroy();
        }
        if (!parser.destroyed) {
          parser.destroy();
        }
        if (!requestLimiter.destroyed) {
          requestLimiter.destroy();
        }
        request.resume();
      };

      const fail = (error: RagUploadException): void => {
        if (failureStarted || completionStarted) {
          return;
        }
        failureStarted = true;
        uploadAbortController.abort();
        // Do not destroy Busboy synchronously from one of its callbacks (most
        // importantly the file `limit` event) because it still updates its
        // active stream state after the callback returns.
        queueMicrotask(stopReadingMultipart);

        void (async () => {
          const startedUpload = uploadTask;
          if (startedUpload) {
            try {
              await startedUpload;
            } catch {
              // The original stable failure remains authoritative.
            }
            try {
              await this.objectStore.deleteObject({
                objectKey: options.objectKey,
              });
            } catch {
              this.logger.error(
                JSON.stringify({
                  code: 'RAG_OBJECT_DELETE_FAILED',
                  event: 'rag_upload_compensation_failed',
                  operationId: options.operationId ?? null,
                }),
              );
              // Never replace a validation response with a provider-derived
              // deletion error. A separate orphan reconciler can retry it.
            }
          }

          removeRequestListeners();
          reject(error);
        })();
      };

      const tryComplete = (): void => {
        if (
          completionStarted ||
          failureStarted ||
          !acceptedFile ||
          !parserClosed ||
          !streamResult ||
          !uploadTask
        ) {
          return;
        }
        const completedFile = acceptedFile;
        const completedStream = streamResult;
        const completedDisplayName = displayName;
        completionStarted = true;

        void uploadTask.then(
          () => {
            removeRequestListeners();
            resolve({
              ...completedFile,
              ...(completedDisplayName === undefined
                ? {}
                : { displayName: completedDisplayName }),
              ...completedStream,
            });
          },
          () => {
            completionStarted = false;
            fail(new RagUploadException('RAG_UPLOAD_STORAGE_UNAVAILABLE'));
          },
        );
      };

      const onRequestAborted = (): void => {
        fail(new RagUploadException('RAG_UPLOAD_ABORTED'));
      };
      const onRequestError = (): void => {
        fail(new RagUploadException('RAG_UPLOAD_MULTIPART_INVALID'));
      };

      request.once('aborted', onRequestAborted);
      request.once('error', onRequestError);
      requestLimiter.once('error', (error: Error) => {
        fail(toRagUploadException(error));
      });

      parser.on(
        'field',
        (
          fieldName: string,
          value: string,
          info: busboy.FieldInfo,
        ): void => {
          if (fieldName !== DISPLAY_NAME_FIELD || displayName !== undefined) {
            fail(new RagUploadException('RAG_UPLOAD_UNEXPECTED_FIELD'));
            return;
          }
          if (info.nameTruncated || info.valueTruncated) {
            fail(new RagUploadException('RAG_UPLOAD_DISPLAY_NAME_INVALID'));
            return;
          }

          try {
            displayName = normalizeDisplayName(value);
          } catch (error) {
            fail(toRagUploadException(error));
          }
        },
      );

      parser.on(
        'file',
        (
          fieldName: string,
          stream: Readable,
          info: busboy.FileInfo,
        ): void => {
          if (fieldName !== FILE_FIELD) {
            stream.resume();
            fail(new RagUploadException('RAG_UPLOAD_UNEXPECTED_FIELD'));
            return;
          }
          if (failureStarted || completionStarted) {
            stream.resume();
            return;
          }
          if (fileSeen) {
            stream.resume();
            fail(new RagUploadException('RAG_UPLOAD_MULTIPLE_FILES'));
            return;
          }
          fileSeen = true;
          fileStream = stream;
          stream.once('error', () => {
            fail(new RagUploadException('RAG_UPLOAD_MULTIPART_INVALID'));
          });

          try {
            acceptedFile = validateFileInfo(info);
          } catch (error) {
            stream.resume();
            fail(toRagUploadException(error));
            return;
          }

          streamValidator = new RagSourceValidationTransform(
            acceptedFile.mimeType,
            options.maxBytes,
          );
          streamValidator.once('error', (error: Error) => {
            fail(toRagUploadException(error));
          });
          streamValidator.once('finish', () => {
            try {
              streamResult = streamValidator?.getValidatedResult();
              tryComplete();
            } catch (error) {
              fail(toRagUploadException(error));
            }
          });

          stream.once('limit', () => {
            fail(new RagUploadException('RAG_UPLOAD_FILE_TOO_LARGE'));
          });

          uploadTask = Promise.resolve().then(() =>
            this.objectStore.putObject({
              abortSignal: uploadAbortController.signal,
              body: streamValidator as RagSourceValidationTransform,
              contentType: acceptedFile?.mimeType as RagSourceMimeType,
              objectKey: options.objectKey,
            }),
          );
          void uploadTask.then(
            () => {
              tryComplete();
            },
            () => {
              if (!failureStarted) {
                fail(
                  new RagUploadException('RAG_UPLOAD_STORAGE_UNAVAILABLE'),
                );
              }
            },
          );

          stream.pipe(streamValidator);
        },
      );

      parser.once('filesLimit', () => {
        fail(new RagUploadException('RAG_UPLOAD_MULTIPLE_FILES'));
      });
      parser.once('fieldsLimit', () => {
        fail(new RagUploadException('RAG_UPLOAD_UNEXPECTED_FIELD'));
      });
      parser.once('partsLimit', () => {
        fail(new RagUploadException('RAG_UPLOAD_UNEXPECTED_FIELD'));
      });
      parser.once('error', () => {
        fail(new RagUploadException('RAG_UPLOAD_MULTIPART_INVALID'));
      });
      parser.once('close', () => {
        parserClosed = true;
        if (!fileSeen) {
          fail(new RagUploadException('RAG_UPLOAD_FILE_REQUIRED'));
          return;
        }
        tryComplete();
      });

      resetIdleTimer();
      request.pipe(requestLimiter).pipe(parser);
    });
  }

  private validateOptions(options: RagMultipartUploadOptions): void {
    if (
      !Number.isSafeInteger(options.maxBytes) ||
      options.maxBytes < 1 ||
      options.maxBytes >= Number.MAX_SAFE_INTEGER
    ) {
      throw new RagUploadException('RAG_UPLOAD_CONFIGURATION_INVALID');
    }
    try {
      assertRagSourceObjectKey(options.objectKey);
      if (
        options.operationId !== undefined &&
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
          options.operationId,
        )
      ) {
        throw new Error('invalid operation ID');
      }
    } catch {
      throw new RagUploadException('RAG_UPLOAD_CONFIGURATION_INVALID');
    }
  }
}

class RagSourceValidationTransform extends Transform {
  private readonly decoder: TextDecoder | undefined;
  private readonly digest: Hash = createHash('sha256');
  private pendingPrefix = Buffer.alloc(0);
  private prefixValidated = false;
  private result: ValidatedStreamResult | undefined;
  private sizeBytes = 0;

  constructor(
    private readonly mimeType: RagSourceMimeType,
    private readonly maxBytes: number,
  ) {
    super();
    this.decoder =
      mimeType === 'text/plain'
        ? new TextDecoder('utf-8', { fatal: true })
        : undefined;
  }

  override _transform(
    chunk: Buffer | string,
    encoding: BufferEncoding,
    callback: TransformCallback,
  ): void {
    try {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
      this.sizeBytes += bytes.byteLength;
      if (this.sizeBytes > this.maxBytes) {
        throw new RagUploadException('RAG_UPLOAD_FILE_TOO_LARGE');
      }

      this.digest.update(bytes);
      this.validateText(bytes);
      this.pushWithValidatedPrefix(bytes);
      callback();
    } catch (error) {
      callback(toRagUploadException(error));
    }
  }

  override _flush(callback: TransformCallback): void {
    try {
      if (this.sizeBytes === 0) {
        throw new RagUploadException('RAG_UPLOAD_EMPTY_FILE');
      }

      if (!this.prefixValidated) {
        this.validatePrefix(this.pendingPrefix);
        this.prefixValidated = true;
        this.push(this.pendingPrefix);
        this.pendingPrefix = Buffer.alloc(0);
      }

      if (this.decoder) {
        this.decoder.decode();
      }

      this.result = {
        sha256Digest: this.digest.digest('hex'),
        sizeBytes: this.sizeBytes,
      };
      callback();
    } catch (error) {
      callback(toRagUploadException(error));
    }
  }

  getValidatedResult(): ValidatedStreamResult {
    if (!this.result) {
      throw new RagUploadException('RAG_UPLOAD_MULTIPART_INVALID');
    }
    return this.result;
  }

  private validateText(bytes: Buffer): void {
    if (!this.decoder) {
      return;
    }
    if (bytes.includes(0)) {
      throw new RagUploadException('RAG_UPLOAD_TEXT_ENCODING_INVALID');
    }

    try {
      this.decoder.decode(bytes, { stream: true });
    } catch {
      throw new RagUploadException('RAG_UPLOAD_TEXT_ENCODING_INVALID');
    }
  }

  private pushWithValidatedPrefix(bytes: Buffer): void {
    if (this.prefixValidated) {
      this.push(bytes);
      return;
    }

    const needed = SNIFF_PREFIX_BYTES - this.pendingPrefix.byteLength;
    const prefixPart = bytes.subarray(0, needed);
    this.pendingPrefix = Buffer.concat([this.pendingPrefix, prefixPart]);
    const remainder = bytes.subarray(prefixPart.byteLength);

    if (this.pendingPrefix.byteLength < SNIFF_PREFIX_BYTES) {
      return;
    }

    this.validatePrefix(this.pendingPrefix);
    this.prefixValidated = true;
    this.push(this.pendingPrefix);
    if (remainder.byteLength > 0) {
      this.push(remainder);
    }
    this.pendingPrefix = Buffer.alloc(0);
  }

  private validatePrefix(prefix: Buffer): void {
    const hasPdfSignature =
      prefix.byteLength >= PDF_SIGNATURE_BYTES &&
      prefix.subarray(0, PDF_SIGNATURE_BYTES).equals(PDF_SIGNATURE);
    const hasBomPrefixedPdfSignature =
      prefix.byteLength >= UTF8_BOM.byteLength + PDF_SIGNATURE_BYTES &&
      prefix.subarray(0, UTF8_BOM.byteLength).equals(UTF8_BOM) &&
      prefix
        .subarray(
          UTF8_BOM.byteLength,
          UTF8_BOM.byteLength + PDF_SIGNATURE_BYTES,
        )
        .equals(PDF_SIGNATURE);

    if (this.mimeType === 'application/pdf' && !hasPdfSignature) {
      throw new RagUploadException('RAG_UPLOAD_SIGNATURE_INVALID');
    }
    if (
      this.mimeType === 'text/plain' &&
      (hasPdfSignature || hasBomPrefixedPdfSignature)
    ) {
      throw new RagUploadException('RAG_UPLOAD_SIGNATURE_INVALID');
    }
  }
}

function validateFileInfo(info: busboy.FileInfo): AcceptedFileInfo {
  const originalFilename = normalizeOriginalFilename(info.filename);
  const extension = originalFilename
    .slice(originalFilename.lastIndexOf('.') + 1)
    .toLowerCase();
  const normalizedMimeType = info.mimeType.trim().toLowerCase();

  if (extension !== 'pdf' && extension !== 'txt') {
    throw new RagUploadException('RAG_UPLOAD_UNSUPPORTED_FILE_TYPE');
  }

  const expectedMimeType: RagSourceMimeType =
    extension === 'pdf' ? 'application/pdf' : 'text/plain';
  if (normalizedMimeType !== expectedMimeType) {
    throw new RagUploadException('RAG_UPLOAD_MIME_MISMATCH');
  }

  return {
    fileExtension: extension,
    mimeType: expectedMimeType,
    originalFilename,
  };
}

function normalizeOriginalFilename(value: string): string {
  const normalized = value.trim().normalize('NFC');
  if (
    normalized.length === 0 ||
    Buffer.byteLength(normalized, 'utf8') > MAX_FILENAME_BYTES ||
    CONTROL_CHARACTER_PATTERN.test(normalized) ||
    normalized.includes('/') ||
    normalized.includes('\\') ||
    normalized === '.' ||
    normalized === '..'
  ) {
    throw new RagUploadException('RAG_UPLOAD_FILENAME_INVALID');
  }

  return normalized;
}

function normalizeDisplayName(value: string): string {
  const normalized = value.trim().normalize('NFC');
  if (
    normalized.length === 0 ||
    normalized.length > MAX_DISPLAY_NAME_CHARACTERS ||
    Buffer.byteLength(normalized, 'utf8') > MAX_DISPLAY_NAME_BYTES ||
    CONTROL_CHARACTER_PATTERN.test(normalized)
  ) {
    throw new RagUploadException('RAG_UPLOAD_DISPLAY_NAME_INVALID');
  }
  return normalized;
}

class MultipartRequestLimitTransform extends Transform {
  private sizeBytes = 0;

  constructor(
    private readonly maxBytes: number,
    private readonly onActivity: () => void,
  ) {
    super();
  }

  override _transform(
    chunk: Buffer | string,
    encoding: BufferEncoding,
    callback: TransformCallback,
  ): void {
    this.onActivity();
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
    this.sizeBytes += bytes.byteLength;
    if (this.sizeBytes > this.maxBytes) {
      callback(new RagUploadException('RAG_UPLOAD_FILE_TOO_LARGE'));
      return;
    }
    callback(null, bytes);
  }
}

function assertContentLengthWithinLimit(
  request: Request,
  maxBytes: number,
): void {
  const raw = request.headers['content-length'];
  if (raw === undefined) return;
  if (
    Array.isArray(raw) ||
    !/^\d+$/u.test(raw) ||
    !Number.isSafeInteger(Number(raw))
  ) {
    throw new RagUploadException('RAG_UPLOAD_MULTIPART_INVALID');
  }
  if (Number(raw) > maxBytes) {
    throw new RagUploadException('RAG_UPLOAD_FILE_TOO_LARGE');
  }
}

function toRagUploadException(error: unknown): RagUploadException {
  return error instanceof RagUploadException
    ? error
    : new RagUploadException('RAG_UPLOAD_MULTIPART_INVALID');
}
