import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AppToken, CredentialStatus, Prisma } from '@prisma/client';

import { generateCredentialSecret } from '@/common/security/credential-secret';
import { ListEnvelope } from '@/common/types/envelope';
import { PrismaService } from '@/infrastructure/database/prisma/prisma.service';

import {
  AppTokenListItemDto,
  AppTokenRevokedResponseDto,
  IssueAppTokenDto,
  ListAppTokensQueryDto,
  OneTimeAppTokenResponseDto,
} from './dto/app-token.dto';

const APP_TOKEN_PREFIX = 'gat_app_';
const DEFAULT_APP_TOKEN_SCOPES = ['gateway:invoke'];
const PLAINTEXT_WARNING =
  'Store this value now. GateLM will not show it again.';

@Injectable()
export class AppTokensService {
  constructor(private readonly prisma: PrismaService) {}

  async issueAppToken(
    applicationId: string,
    dto: IssueAppTokenDto,
  ): Promise<OneTimeAppTokenResponseDto> {
    const application = await this.getApplicationOrThrow(applicationId);
    const secret = generateCredentialSecret(APP_TOKEN_PREFIX);

    const appToken = await this.prisma.appToken.create({
      data: {
        tenantId: application.tenantId,
        projectId: application.projectId,
        applicationId: application.id,
        displayName: dto.displayName,
        prefix: secret.prefix,
        last4: secret.last4,
        secretHash: secret.secretHash,
        hashAlgorithm: secret.hashAlgorithm,
        scopes: this.resolveScopes(dto.scopes, DEFAULT_APP_TOKEN_SCOPES),
        expiresAt: this.toNullableDate(dto.expiresAt),
      },
    });

    return this.toOneTimeResponse(appToken, secret.plaintext);
  }

  async listAppTokens(
    applicationId: string,
    query: ListAppTokensQueryDto,
  ): Promise<ListEnvelope<AppTokenListItemDto>> {
    await this.getApplicationOrThrow(applicationId);

    const limit = query.limit ?? 50;
    const appTokens = await this.prisma.appToken.findMany({
      where: { applicationId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const hasMore = appTokens.length > limit;
    const page = appTokens.slice(0, limit);

    return {
      data: page.map((appToken) => this.toListItem(appToken)),
      pagination: {
        limit,
        nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
        hasMore,
      },
    };
  }

  async rotateAppToken(
    appTokenId: string,
  ): Promise<OneTimeAppTokenResponseDto> {
    const previous = await this.getAppTokenOrThrow(appTokenId);
    const now = new Date();
    this.assertRotatableCredential(previous, now);
    const secret = generateCredentialSecret(previous.prefix || APP_TOKEN_PREFIX);

    const rotated = await this.prisma.$transaction(async (tx) => {
      await tx.appToken.update({
        where: { id: previous.id },
        data: {
          status: CredentialStatus.REVOKED,
          revokedAt: now,
        },
      });

      return tx.appToken.create({
        data: {
          tenantId: previous.tenantId,
          projectId: previous.projectId,
          applicationId: previous.applicationId,
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

  async revokeAppToken(
    appTokenId: string,
  ): Promise<AppTokenRevokedResponseDto> {
    const existing = await this.getAppTokenOrThrow(appTokenId);
    if (existing.status === CredentialStatus.REVOKED && existing.revokedAt) {
      return this.toRevokedResponse(existing.id, existing.revokedAt);
    }

    const revokedAt = existing.revokedAt ?? new Date();
    const appToken = await this.prisma.appToken
      .update({
        where: { id: appTokenId },
        data: {
          status: CredentialStatus.REVOKED,
          revokedAt,
        },
      })
      .catch((error: unknown) => {
        if (this.isRecordNotFoundError(error)) {
          throw new NotFoundException('App Token not found.');
        }

        throw error;
      });

    return this.toRevokedResponse(appToken.id, appToken.revokedAt ?? revokedAt);
  }

  private async getApplicationOrThrow(
    applicationId: string,
  ): Promise<{ id: string; tenantId: string; projectId: string }> {
    const application = await this.prisma.application.findUnique({
      where: { id: applicationId },
      select: { id: true, tenantId: true, projectId: true },
    });

    if (!application) {
      throw new NotFoundException('Application not found.');
    }

    return application;
  }

  private async getAppTokenOrThrow(appTokenId: string): Promise<AppToken> {
    const appToken = await this.prisma.appToken.findUnique({
      where: { id: appTokenId },
    });

    if (!appToken) {
      throw new NotFoundException('App Token not found.');
    }

    return appToken;
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

  private assertRotatableCredential(appToken: AppToken, now: Date): void {
    if (
      appToken.status !== CredentialStatus.ACTIVE ||
      (appToken.expiresAt !== null && appToken.expiresAt <= now)
    ) {
      throw new ConflictException('App Token cannot be rotated.');
    }
  }

  private toRevokedResponse(
    credentialId: string,
    revokedAt: Date,
  ): AppTokenRevokedResponseDto {
    return {
      credentialId,
      status: 'revoked',
      revokedAt: revokedAt.toISOString(),
    };
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
    appToken: AppToken,
    plaintext: string,
  ): OneTimeAppTokenResponseDto {
    return {
      credentialId: appToken.id,
      credentialType: 'app_token',
      plaintext,
      plaintextShownOnce: true,
      prefix: appToken.prefix,
      last4: appToken.last4,
      status: this.toStatus(appToken.status),
      scopes: appToken.scopes,
      createdAt: appToken.createdAt.toISOString(),
      expiresAt: appToken.expiresAt?.toISOString() ?? null,
      warning: PLAINTEXT_WARNING,
    };
  }

  private toListItem(appToken: AppToken): AppTokenListItemDto {
    return {
      credentialId: appToken.id,
      credentialType: 'app_token',
      displayName: appToken.displayName,
      prefix: appToken.prefix,
      last4: appToken.last4,
      status: this.toStatus(appToken.status),
      scopes: appToken.scopes,
      createdAt: appToken.createdAt.toISOString(),
      expiresAt: appToken.expiresAt?.toISOString() ?? null,
      lastUsedAt: appToken.lastUsedAt?.toISOString() ?? null,
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
