import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '@/database/prisma.service';

import { ContentIntegrityError, ContentKeyUnavailable } from './content.errors';
import { newTenantKey, unwrapTenantKey, wrapTenantKey } from './content-crypto';
import { WrappingKeyProvider, type WrappingKeySet } from './wrapping-key-provider';

type ContentKeyRow = Readonly<{
  tenantId: string;
  contentKeyVersion: number;
  wrappingKeyVersion: number;
  wrappedKey: Uint8Array;
  wrapNonce: Uint8Array;
  wrapTag: Uint8Array;
}>;

@Injectable()
export class TenantContentKeyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly provider: WrappingKeyProvider,
  ) {}

  async isReady(): Promise<boolean> {
    try {
      const keySet = await this.provider.load();
      const [state, contentKeys, conversations, turns] = await Promise.all([
        this.prisma.tenantChatContentKeyState.findFirst({
          select: { wrappingKeyRollbackFloor: true },
          orderBy: { wrappingKeyRollbackFloor: 'desc' },
        }),
        this.prisma.tenantChatContentKey.groupBy({
          by: ['wrappingKeyVersion'],
          where: { status: { not: 'retired' } },
        }),
        this.prisma.tenantChatConversation.groupBy({ by: ['creationBindingKeyVersion'] }),
        this.prisma.tenantChatTurn.groupBy({ by: ['requestBindingKeyVersion'] }),
      ]);
      if (state && keySet.activeVersion < state.wrappingKeyRollbackFloor) return false;
      const requiredVersions = new Set([
        ...contentKeys.map((row) => row.wrappingKeyVersion),
        ...conversations.map((row) => row.creationBindingKeyVersion),
        ...turns.map((row) => row.requestBindingKeyVersion),
      ]);
      return [...requiredVersions].every((version) => keySet.keys.has(version));
    } catch {
      return false;
    }
  }

  async withActiveKey<T>(
    tenantId: string,
    operation: (key: Buffer, contentKeyVersion: number) => Promise<T> | T,
  ): Promise<T> {
    const resolved = await this.resolveActive(tenantId);
    try {
      return await operation(resolved.key, resolved.version);
    } finally {
      resolved.key.fill(0);
    }
  }

  async withKeyVersion<T>(
    tenantId: string,
    contentKeyVersion: number,
    operation: (key: Buffer) => Promise<T> | T,
  ): Promise<T> {
    const keySet = await this.provider.load();
    const state = await this.prisma.tenantChatContentKeyState.findUnique({ where: { tenantId } });
    if (!state || keySet.activeVersion < state.wrappingKeyRollbackFloor) {
      throw new ContentKeyUnavailable();
    }
    const row = await this.prisma.tenantChatContentKey.findUnique({
      where: { tenantId_contentKeyVersion: { tenantId, contentKeyVersion } },
    });
    if (!row || row.status === 'retired') throw new ContentKeyUnavailable();
    const key = unwrap(row, keySet);
    try {
      return await operation(key);
    } finally {
      key.fill(0);
    }
  }

  async rotateContentKey(tenantId: string): Promise<number> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const keySet = await this.provider.load();
      const state = await this.ensureState(tenantId, keySet.activeVersion);
      if (keySet.activeVersion < state.wrappingKeyRollbackFloor) {
        throw new ContentKeyUnavailable();
      }
      const nextVersion = state.activeContentKeyVersion + 1;
      const wrapping = keySet.keys.get(keySet.activeVersion);
      if (!wrapping) throw new ContentKeyUnavailable();
      const tenantKey = newTenantKey();
      try {
        const encrypted = wrapTenantKey(
          tenantKey,
          wrapping.wrappingKey,
          tenantId,
          nextVersion,
          wrapping.version,
        );
        try {
          await this.prisma.$transaction(async (tx) => {
            const changed = await tx.tenantChatContentKeyState.updateMany({
              where: { tenantId, activeContentKeyVersion: state.activeContentKeyVersion },
              data: {
                activeContentKeyVersion: nextVersion,
                wrappingKeyRollbackFloor: Math.max(
                  state.wrappingKeyRollbackFloor,
                  wrapping.version,
                ),
              },
            });
            if (changed.count !== 1) throw new ConcurrentKeyRotation();
            await tx.tenantChatContentKey.updateMany({
              where: { tenantId, contentKeyVersion: state.activeContentKeyVersion, status: 'active' },
              data: { status: 'grace' },
            });
            await tx.tenantChatContentKey.create({
              data: {
                tenantId,
                contentKeyVersion: nextVersion,
                wrappingKeyVersion: encrypted.wrappingKeyVersion,
                wrappedKey: Uint8Array.from(encrypted.wrappedKey),
                wrapNonce: Uint8Array.from(encrypted.wrapNonce),
                wrapTag: Uint8Array.from(encrypted.wrapTag),
              },
            });
          });
          return nextVersion;
        } catch (error) {
          if (error instanceof ConcurrentKeyRotation || isUniqueConflict(error)) continue;
          throw error;
        }
      } finally {
        tenantKey.fill(0);
      }
    }
    throw new ContentKeyUnavailable();
  }

  private async resolveActive(
    tenantId: string,
  ): Promise<Readonly<{ key: Buffer; version: number }>> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const keySet = await this.provider.load();
      const state = await this.ensureState(tenantId, keySet.activeVersion);
      if (keySet.activeVersion < state.wrappingKeyRollbackFloor) {
        throw new ContentKeyUnavailable();
      }
      let row = await this.prisma.tenantChatContentKey.findUnique({
        where: {
          tenantId_contentKeyVersion: {
            tenantId,
            contentKeyVersion: state.activeContentKeyVersion,
          },
        },
      });
      if (!row) {
        await this.createInitialKey(tenantId, state.activeContentKeyVersion, keySet);
        continue;
      }
      if (row.status === 'retired' || row.wrappingKeyVersion < state.wrappingKeyRollbackFloor) {
        throw new ContentKeyUnavailable();
      }
      let key = unwrap(row, keySet);
      try {
        if (row.wrappingKeyVersion !== keySet.activeVersion) {
          if (row.wrappingKeyVersion > keySet.activeVersion) {
            throw new ContentKeyUnavailable();
          }
          const active = keySet.keys.get(keySet.activeVersion);
          if (!active) throw new ContentKeyUnavailable();
          const rewrapped = wrapTenantKey(
            key,
            active.wrappingKey,
            tenantId,
            row.contentKeyVersion,
            active.version,
          );
          const changed = await this.prisma.$transaction(async (tx) => {
            const updated = await tx.tenantChatContentKey.updateMany({
              where: {
                tenantId,
                contentKeyVersion: row!.contentKeyVersion,
                wrappingKeyVersion: row!.wrappingKeyVersion,
              },
              data: {
                wrappingKeyVersion: active.version,
                wrappedKey: Uint8Array.from(rewrapped.wrappedKey),
                wrapNonce: Uint8Array.from(rewrapped.wrapNonce),
                wrapTag: Uint8Array.from(rewrapped.wrapTag),
                rewrappedAt: new Date(),
              },
            });
            const floor = await tx.tenantChatContentKeyState.updateMany({
              where: {
                tenantId,
                wrappingKeyRollbackFloor: { lte: active.version },
              },
              data: { wrappingKeyRollbackFloor: active.version },
            });
            return updated.count === 1 && floor.count === 1;
          });
          if (!changed) {
            key.fill(0);
            continue;
          }
        }
        return Object.freeze({ key, version: row.contentKeyVersion });
      } catch (error) {
        key.fill(0);
        throw error;
      }
    }
    throw new ContentKeyUnavailable();
  }

  private async ensureState(tenantId: string, activeWrappingVersion: number) {
    return this.prisma.tenantChatContentKeyState.upsert({
      where: { tenantId },
      create: {
        tenantId,
        activeContentKeyVersion: 1,
        wrappingKeyRollbackFloor: activeWrappingVersion,
      },
      update: {},
    });
  }

  private async createInitialKey(
    tenantId: string,
    contentKeyVersion: number,
    keySet: WrappingKeySet,
  ): Promise<void> {
    const active = keySet.keys.get(keySet.activeVersion);
    if (!active) throw new ContentKeyUnavailable();
    const tenantKey = newTenantKey();
    try {
      const encrypted = wrapTenantKey(
        tenantKey,
        active.wrappingKey,
        tenantId,
        contentKeyVersion,
        active.version,
      );
      try {
        await this.prisma.$transaction([
          this.prisma.tenantChatContentKey.create({
            data: {
              tenantId,
              contentKeyVersion,
              wrappingKeyVersion: active.version,
              wrappedKey: Uint8Array.from(encrypted.wrappedKey),
              wrapNonce: Uint8Array.from(encrypted.wrapNonce),
              wrapTag: Uint8Array.from(encrypted.wrapTag),
            },
          }),
          this.prisma.tenantChatContentKeyState.update({
            where: { tenantId },
            data: { wrappingKeyRollbackFloor: active.version },
          }),
        ]);
      } catch (error) {
        if (!isUniqueConflict(error)) throw error;
      }
    } finally {
      tenantKey.fill(0);
    }
  }
}

function unwrap(row: ContentKeyRow, keySet: WrappingKeySet): Buffer {
  const wrapping = keySet.keys.get(row.wrappingKeyVersion);
  if (!wrapping) throw new ContentKeyUnavailable();
  try {
    return unwrapTenantKey(
      {
        wrappedKey: Buffer.from(row.wrappedKey),
        wrapNonce: Buffer.from(row.wrapNonce),
        wrapTag: Buffer.from(row.wrapTag),
        wrappingKeyVersion: row.wrappingKeyVersion,
      },
      wrapping.wrappingKey,
      row.tenantId,
      row.contentKeyVersion,
    );
  } catch (error) {
    if (error instanceof ContentIntegrityError) throw error;
    throw new ContentKeyUnavailable();
  }
}

function isUniqueConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

class ConcurrentKeyRotation extends Error {}
