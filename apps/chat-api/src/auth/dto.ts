import { Transform } from 'class-transformer';
import { IsEmail, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

const trim = (value: unknown) => (typeof value === 'string' ? value.trim() : value);

export class PasswordLoginDto {
  @Transform(({ value }) => trim(value))
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(256)
  password!: string;

  @IsString()
  @MinLength(16)
  @MaxLength(256)
  deviceId!: string;
}

export class InvitationTokenDto {
  @Transform(({ value }) => trim(value))
  @IsString()
  @MinLength(16)
  @MaxLength(512)
  token!: string;
}

export class InvitationPasswordDto {
  @IsString()
  @MinLength(16)
  @MaxLength(4096)
  intent!: string;

  @Transform(({ value }) => trim(value))
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(256)
  password!: string;

  @IsString()
  @MinLength(16)
  @MaxLength(256)
  deviceId!: string;
}

export class InvitationIntentDto {
  @IsString()
  @MinLength(16)
  @MaxLength(4096)
  intent!: string;
}

export class TenantSelectionDto {
  @IsUUID()
  tenantId!: string;
}

export class GoogleCompleteDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  code!: string;

  @IsString()
  @MinLength(16)
  @MaxLength(256)
  deviceId!: string;

  @IsString()
  @MinLength(16)
  @MaxLength(256)
  expectedState!: string;

  @IsString()
  @MinLength(16)
  @MaxLength(256)
  state!: string;
}
