import { Transform } from 'class-transformer';
import { IsEmail, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

const NEW_PASSWORD_MAX_LENGTH = 15;
const NEW_PASSWORD_MIN_LENGTH = 8;
const NEW_PASSWORD_POLICY_MESSAGE =
  'Use 8 to 15 characters and include at least one uppercase letter, lowercase letter, number, and special character. Spaces are not allowed.';

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

export class PasswordResetRequestDto {
  @Transform(({ value }) => trim(value))
  @IsEmail()
  @MaxLength(254)
  email!: string;
}

export class PasswordResetConfirmDto {
  @Transform(({ value }) => trim(value))
  @IsString()
  @MinLength(32)
  @MaxLength(512)
  token!: string;

  @IsString()
  @MinLength(NEW_PASSWORD_MIN_LENGTH, { message: NEW_PASSWORD_POLICY_MESSAGE })
  @MaxLength(NEW_PASSWORD_MAX_LENGTH, { message: NEW_PASSWORD_POLICY_MESSAGE })
  newPassword!: string;
}

export class PasswordChangeDto {
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  currentPassword!: string;

  @IsString()
  @MinLength(NEW_PASSWORD_MIN_LENGTH, { message: NEW_PASSWORD_POLICY_MESSAGE })
  @MaxLength(NEW_PASSWORD_MAX_LENGTH, { message: NEW_PASSWORD_POLICY_MESSAGE })
  newPassword!: string;
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
  @MinLength(NEW_PASSWORD_MIN_LENGTH, { message: NEW_PASSWORD_POLICY_MESSAGE })
  @MaxLength(NEW_PASSWORD_MAX_LENGTH, { message: NEW_PASSWORD_POLICY_MESSAGE })
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
