import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

function trimString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export type CredentialStatusDto = 'active' | 'revoked' | 'expired' | 'disabled';
export type AppTokenCredentialType = 'app_token';

export class IssueAppTokenDto {
  @Transform(({ value }) => trimString(value))
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  displayName!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  scopes?: string[];

  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsISO8601()
  expiresAt?: string | null;
}

export class ListAppTokensQueryDto {
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 50;

  @IsOptional()
  @IsUUID()
  cursor?: string;
}

export interface OneTimeAppTokenResponseDto {
  credentialId: string;
  credentialType: AppTokenCredentialType;
  plaintext: string;
  plaintextShownOnce: true;
  prefix: string;
  last4: string;
  status: CredentialStatusDto;
  scopes: string[];
  createdAt: string;
  expiresAt: string | null;
  warning: string;
}

export interface AppTokenListItemDto {
  credentialId: string;
  credentialType: AppTokenCredentialType;
  displayName: string;
  prefix: string;
  last4: string;
  status: CredentialStatusDto;
  scopes: string[];
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
}

export interface AppTokenRevokedResponseDto {
  credentialId: string;
  status: 'revoked';
  revokedAt: string;
}
