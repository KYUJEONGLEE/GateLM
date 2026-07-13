import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

function trim(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class TenantChatPasswordDto {
  @Transform(({ value }) => trim(value))
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(256)
  password!: string;
}

export class TenantChatInvitationTokenDto {
  @Transform(({ value }) => trim(value))
  @IsString()
  @MinLength(16)
  @MaxLength(512)
  token!: string;
}

export class TenantChatInvitationPasswordDto extends TenantChatInvitationTokenDto {
  @Transform(({ value }) => trim(value))
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(256)
  password!: string;
}

export class TenantChatInvitationBindDto extends TenantChatInvitationTokenDto {
  @IsUUID()
  userId!: string;
}

export class TenantChatGoogleStartDto {
  @Transform(({ value }) => trim(value))
  @IsString()
  @MinLength(24)
  @MaxLength(256)
  state!: string;
}

export class TenantChatGoogleCompleteDto {
  @Transform(({ value }) => trim(value))
  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  code!: string;

  @Transform(({ value }) => trim(value))
  @IsOptional()
  @IsString()
  @MinLength(16)
  @MaxLength(512)
  invitationToken?: string;
}
