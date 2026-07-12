import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  ResourceStatus,
  RuntimeConfigPublishState,
} from '@prisma/client';

import { PrismaService } from '@/infrastructure/database/prisma/prisma.service';

import {
  computeTenantChatPolicyDigest,
  TenantChatRuntimeContractError,
  validateTenantChatRuntimeSnapshot,
} from './tenant-chat-runtime.contract';
import type {
  PublishTenantChatRuntimeSnapshotInput,
  TenantChatRuntimeSnapshotDocument,
} from './tenant-chat-runtime.types';

@Injectable()
export class TenantChatRuntimeService {
  constructor(private readonly prisma: PrismaService) {}

  async getActiveSnapshot(
    tenantId: string,
  ): Promise<TenantChatRuntimeSnapshotDocument> {
    const pointer = await this.prisma.tenantChatActiveRuntimeSnapshot.findUnique({
      where: { tenantId },
      include: { snapshot: true },
    });
    if (!pointer) {
      throw new NotFoundException('Active Tenant Chat runtime snapshot not found.');
    }

    return this.toSnapshotDocument(pointer.snapshot.snapshotBody);
  }

  async publishSnapshot(
    input: PublishTenantChatRuntimeSnapshotInput,
  ): Promise<TenantChatRuntimeSnapshotDocument> {
    const { snapshot } = input;
    try {
      validateTenantChatRuntimeSnapshot(snapshot);
    } catch (error) {
      if (error instanceof TenantChatRuntimeContractError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await this.prisma.$transaction(
          async (tx) => this.publishInTransaction(tx, snapshot),
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        if (attempt === 0 && this.isRetryablePublishConflict(error)) {
          continue;
        }
        throw error;
      }
    }

    throw new ConflictException('Tenant Chat runtime publish did not converge.');
  }

  private async publishInTransaction(
    tx: Prisma.TransactionClient,
    snapshot: TenantChatRuntimeSnapshotDocument,
  ): Promise<TenantChatRuntimeSnapshotDocument> {
    const tenant = await tx.tenant.findUnique({
      where: { id: snapshot.tenantId },
      select: { id: true, status: true },
    });
    if (!tenant || tenant.status !== ResourceStatus.ACTIVE) {
      throw new NotFoundException('Active tenant not found.');
    }

    const existingSnapshot = await tx.tenantChatRuntimeSnapshot.findUnique({
      where: {
        tenantId_version: {
          tenantId: snapshot.tenantId,
          version: BigInt(snapshot.version),
        },
      },
    });
    if (existingSnapshot) {
      if (
        existingSnapshot.snapshotId !== snapshot.snapshotId ||
        existingSnapshot.digest !== snapshot.digest
      ) {
        throw new ConflictException(
          'Tenant Chat snapshot version is already bound to different content.',
        );
      }
      const activePointer = await tx.tenantChatActiveRuntimeSnapshot.findUnique({
        where: { tenantId: snapshot.tenantId },
        select: { snapshotId: true },
      });
      if (activePointer?.snapshotId !== existingSnapshot.snapshotId) {
        throw new ConflictException(
          'A historical Tenant Chat snapshot cannot be reactivated; publish a new monotonic version.',
        );
      }
      return this.toSnapshotDocument(existingSnapshot.snapshotBody);
    }

    const latestSnapshot = await tx.tenantChatRuntimeSnapshot.findFirst({
      where: { tenantId: snapshot.tenantId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    if (latestSnapshot && BigInt(snapshot.version) <= latestSnapshot.version) {
      throw new ConflictException(
        'Tenant Chat snapshot version must increase monotonically.',
      );
    }

    const pricingCatalog = await this.ensurePricingCatalog(tx, snapshot);
    const runtimeConfig = await this.ensureRuntimeConfig(tx, snapshot);
    const publishedAt = new Date(snapshot.publishedAt);

    await tx.tenantChatRuntimeSnapshot.create({
      data: {
        snapshotId: snapshot.snapshotId,
        tenantId: snapshot.tenantId,
        runtimeConfigId: runtimeConfig.id,
        pricingCatalogId: pricingCatalog.id,
        version: BigInt(snapshot.version),
        digest: snapshot.digest,
        policyVersion: BigInt(snapshot.policyVersion),
        employeeNoticeVersion: BigInt(snapshot.employeeNoticeVersion),
        pricingVersion: BigInt(snapshot.pricing.version),
        pricingDigest: snapshot.pricing.digest,
        snapshotBody: this.toInputJson(snapshot),
        publishedAt,
        publishedBy: snapshot.publishedBy,
      },
    });
    await this.activateSnapshot(tx, snapshot, snapshot.snapshotId);

    return snapshot;
  }

  private async ensurePricingCatalog(
    tx: Prisma.TransactionClient,
    snapshot: TenantChatRuntimeSnapshotDocument,
  ) {
    const existing = await tx.tenantChatPricingCatalog.findUnique({
      where: {
        tenantId_version: {
          tenantId: snapshot.tenantId,
          version: BigInt(snapshot.pricing.version),
        },
      },
    });
    if (existing) {
      if (existing.digest !== snapshot.pricing.digest) {
        throw new ConflictException(
          'Tenant Chat pricing version is already bound to different content.',
        );
      }
      return existing;
    }

    return tx.tenantChatPricingCatalog.create({
      data: {
        tenantId: snapshot.tenantId,
        version: BigInt(snapshot.pricing.version),
        digest: snapshot.pricing.digest,
        currency: snapshot.pricing.currency,
        unit: snapshot.pricing.unit,
        document: this.toInputJson(snapshot.pricing),
        effectiveAt: new Date(snapshot.pricing.effectiveAt),
        publishedAt: new Date(snapshot.publishedAt),
        publishedBy: snapshot.publishedBy,
      },
    });
  }

  private async ensureRuntimeConfig(
    tx: Prisma.TransactionClient,
    snapshot: TenantChatRuntimeSnapshotDocument,
  ) {
    const contentHash = computeTenantChatPolicyDigest(snapshot.policies);
    const existing = await tx.tenantChatRuntimeConfig.findUnique({
      where: {
        tenantId_version: {
          tenantId: snapshot.tenantId,
          version: BigInt(snapshot.policyVersion),
        },
      },
    });
    if (existing) {
      if (existing.contentHash !== contentHash) {
        throw new ConflictException(
          'Tenant Chat policy version is already bound to different content.',
        );
      }
      if (existing.publishState !== RuntimeConfigPublishState.ACTIVE) {
        await this.markRuntimeConfigActive(tx, snapshot.tenantId, existing.id);
      }
      return existing;
    }

    const created = await tx.tenantChatRuntimeConfig.create({
      data: {
        tenantId: snapshot.tenantId,
        version: BigInt(snapshot.policyVersion),
        contentHash,
        publishState: RuntimeConfigPublishState.ACTIVE,
        document: this.toInputJson(snapshot.policies),
        effectiveAt: new Date(snapshot.publishedAt),
        publishedAt: new Date(snapshot.publishedAt),
      },
    });
    await this.markRuntimeConfigActive(tx, snapshot.tenantId, created.id);
    return created;
  }

  private async markRuntimeConfigActive(
    tx: Prisma.TransactionClient,
    tenantId: string,
    runtimeConfigId: string,
  ): Promise<void> {
    await tx.tenantChatRuntimeConfig.updateMany({
      where: {
        tenantId,
        id: { not: runtimeConfigId },
        publishState: RuntimeConfigPublishState.ACTIVE,
      },
      data: { publishState: RuntimeConfigPublishState.SUPERSEDED },
    });
    await tx.tenantChatRuntimeConfig.update({
      where: { id: runtimeConfigId },
      data: { publishState: RuntimeConfigPublishState.ACTIVE },
    });
  }

  private async activateSnapshot(
    tx: Prisma.TransactionClient,
    snapshot: TenantChatRuntimeSnapshotDocument,
    snapshotId: string,
  ): Promise<void> {
    await tx.tenantChatActiveRuntimeSnapshot.upsert({
      where: { tenantId: snapshot.tenantId },
      create: {
        tenantId: snapshot.tenantId,
        snapshotId,
        updatedBy: snapshot.publishedBy,
      },
      update: {
        snapshotId,
        updatedBy: snapshot.publishedBy,
      },
    });
  }

  private toInputJson(value: object): Prisma.InputJsonObject {
    return value as unknown as Prisma.InputJsonObject;
  }

  private toSnapshotDocument(
    value: Prisma.JsonValue,
  ): TenantChatRuntimeSnapshotDocument {
    return value as unknown as TenantChatRuntimeSnapshotDocument;
  }

  private isRetryablePublishConflict(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === 'P2002' || error.code === 'P2034')
    );
  }
}
