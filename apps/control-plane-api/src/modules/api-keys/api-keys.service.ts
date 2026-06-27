import { Injectable, NotFoundException } from '@nestjs/common';
import { CredentialStatus, GatewayApiKey, Prisma } from '@prisma/client';

import { generateCredentialSecret } from '@/common/security/credential-secret';
import { ListEnvelope } from '@/common/types/envelope';
import { PrismaService } from '@/infrastructure/database/prisma/prisma.service';

import {
  ApiKeyListItemDto,
  CredentialRevokedResponseDto,
  IssueApiKeyDto,
  ListApiKeysQueryDto,
  OneTimeApiKeyResponseDto,
} from './dto/api-key.dto';

const API_KEY_PREFIX = 'gsk_live_';
const DEFAULT_API_KEY_SCOPES = ['chat:completions', 'models:read'];
const PLAINTEXT_WARNING =
  'Store this value now. GateLM will not show it again.';

@Injectable()
export class ApiKeysService {
  constructor(private readonly prisma: PrismaService) {}

  async issueApiKey(
    projectId: string,
    dto: IssueApiKeyDto,
  ): Promise<OneTimeApiKeyResponseDto> {
    const project = await this.getProjectOrThrow(projectId);
    const secret = generateCredentialSecret(API_KEY_PREFIX);

    const apiKey = await this.prisma.gatewayApiKey.create({
      data: {
        tenantId: project.tenantId,
        projectId: project.id,
        displayName: dto.displayName,
        prefix: secret.prefix,
        last4: secret.last4,
        secretHash: secret.secretHash,
        hashAlgorithm: secret.hashAlgorithm,
        scopes: this.resolveScopes(dto.scopes, DEFAULT_API_KEY_SCOPES),
        expiresAt: this.toNullableDate(dto.expiresAt),
      },
    });

    return this.toOneTimeResponse(apiKey, secret.plaintext);
  }

  async listApiKeys(
    projectId: string,
    query: ListApiKeysQueryDto,
  ): Promise<ListEnvelope<ApiKeyListItemDto>> {
    await this.getProjectOrThrow(projectId);

    const limit = query.limit ?? 50;
    const apiKeys = await this.prisma.gatewayApiKey.findMany({
      where: { projectId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const hasMore = apiKeys.length > limit;
    const page = apiKeys.slice(0, limit);

    return {
      data: page.map((apiKey) => this.toListItem(apiKey)),
      pagination: {
        limit,
        nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
        hasMore,
      },
    };
  }

  async rotateApiKey(apiKeyId: string): Promise<OneTimeApiKeyResponseDto> {
    const previous = await this.getApiKeyOrThrow(apiKeyId);
    const secret = generateCredentialSecret(previous.prefix || API_KEY_PREFIX);
    const now = new Date();

    const rotated = await this.prisma.$transaction(async (tx) => {
      await tx.gatewayApiKey.update({
        where: { id: previous.id },
        data: {
          status: CredentialStatus.REVOKED,
          revokedAt: now,
        },
      });

      return tx.gatewayApiKey.create({
        data: {
          tenantId: previous.tenantId,
          projectId: previous.projectId,
          displayName: previous.displayName,
          prefix: secret.prefix,
          last4: secret.last4,
          secretHash: secret.secretHash,
          hashAlgorithm: secret.hashAlgorithm,
          scopes: previous.scopes,
          expiresAt: previous.expiresAt,
        },
      });
    });

    return this.toOneTimeResponse(rotated, secret.plaintext);
  }

  async revokeApiKey(apiKeyId: string): Promise<CredentialRevokedResponseDto> {
    const revokedAt = new Date();
    const apiKey = await this.prisma.gatewayApiKey
      .update({
        where: { id: apiKeyId },
        data: {
          status: CredentialStatus.REVOKED,
          revokedAt,
        },
      })
      .catch((error: unknown) => {
        if (this.isRecordNotFoundError(error)) {
          throw new NotFoundException('API Key not found.');
        }

        throw error;
      });

    return {
      credentialId: apiKey.id,
      status: 'revoked',
      revokedAt: (apiKey.revokedAt ?? revokedAt).toISOString(),
    };
  }

  private async getProjectOrThrow(
    projectId: string,
  ): Promise<{ id: string; tenantId: string }> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, tenantId: true },
    });

    if (!project) {
      throw new NotFoundException('Project not found.');
    }

    return project;
  }

  private async getApiKeyOrThrow(apiKeyId: string): Promise<GatewayApiKey> {
    const apiKey = await this.prisma.gatewayApiKey.findUnique({
      where: { id: apiKeyId },
    });

    if (!apiKey) {
      throw new NotFoundException('API Key not found.');
    }

    return apiKey;
  }

  private resolveScopes(
    scopes: string[] | undefined,
    defaultScopes: string[],
  ): string[] {
    const values = scopes?.length ? scopes : defaultScopes;

    return [...new Set(values.map((scope) => scope.trim()).filter(Boolean))];
  }

  private toNullableDate(value: string | null | undefined): Date | null {
    return value ? new Date(value) : null;
  }

  private isRecordNotFoundError(
    error: unknown,
  ): error is Prisma.PrismaClientKnownRequestError {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2025'
    );
  }

  private toOneTimeResponse(
    apiKey: GatewayApiKey,
    plaintext: string,
  ): OneTimeApiKeyResponseDto {
    return {
      credentialId: apiKey.id,
      credentialType: 'api_key',
      plaintext,
      plaintextShownOnce: true,
      prefix: apiKey.prefix,
      last4: apiKey.last4,
      status: this.toStatus(apiKey.status),
      scopes: apiKey.scopes,
      createdAt: apiKey.createdAt.toISOString(),
      expiresAt: apiKey.expiresAt?.toISOString() ?? null,
      warning: PLAINTEXT_WARNING,
    };
  }

  private toListItem(apiKey: GatewayApiKey): ApiKeyListItemDto {
    return {
      credentialId: apiKey.id,
      credentialType: 'api_key',
      displayName: apiKey.displayName,
      prefix: apiKey.prefix,
      last4: apiKey.last4,
      status: this.toStatus(apiKey.status),
      scopes: apiKey.scopes,
      createdAt: apiKey.createdAt.toISOString(),
      expiresAt: apiKey.expiresAt?.toISOString() ?? null,
      lastUsedAt: apiKey.lastUsedAt?.toISOString() ?? null,
    };
  }

  private toStatus(status: CredentialStatus) {
    return status.toLowerCase() as
      | 'active'
      | 'revoked'
      | 'expired'
      | 'disabled';
  }
}
