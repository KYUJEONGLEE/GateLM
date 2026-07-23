import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

function trimString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class SignupDto {
  @Transform(({ value }) => trimString(value))
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @Transform(({ value }) => trimString(value))
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsString()
  @MinLength(15, { message: 'Use at least 15 characters and avoid common or repeated passwords.' })
  @MaxLength(256)
  password!: string;

  @Transform(({ value }) => trimString(value))
  @IsOptional()
  @IsString()
  @MinLength(16)
  @MaxLength(512)
  projectInviteToken?: string;

  @Transform(({ value }) => trimString(value))
  @IsOptional()
  @IsString()
  @MinLength(16)
  @MaxLength(512)
  employeeInviteToken?: string;
}

export class VerifyEmailDto {
  @Transform(({ value }) => trimString(value))
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @Transform(({ value }) => trimString(value))
  @IsString()
  @Matches(/^\d{6}$/)
  code!: string;

  @Transform(({ value }) => trimString(value))
  @IsOptional()
  @IsString()
  @MinLength(16)
  @MaxLength(512)
  projectInviteToken?: string;

  @Transform(({ value }) => trimString(value))
  @IsOptional()
  @IsString()
  @MinLength(16)
  @MaxLength(512)
  employeeInviteToken?: string;
}

export class CreateOrganizationDto {
  @Transform(({ value }) => trimString(value))
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  organizationName!: string;
}

export class LoginDto {
  @Transform(({ value }) => trimString(value))
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(256)
  password!: string;
}

export class RequestPasswordResetDto {
  @Transform(({ value }) => trimString(value))
  @IsEmail()
  @MaxLength(254)
  email!: string;
}

export class ConfirmPasswordResetDto {
  @Transform(({ value }) => trimString(value))
  @IsString()
  @MinLength(32)
  @MaxLength(512)
  token!: string;

  @IsString()
  @MinLength(15, { message: 'Use at least 15 characters and avoid common or repeated passwords.' })
  @MaxLength(256)
  newPassword!: string;
}

export class ChangePasswordDto {
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  currentPassword!: string;

  @IsString()
  @MinLength(15, { message: 'Use at least 15 characters and avoid common or repeated passwords.' })
  @MaxLength(256)
  newPassword!: string;
}
