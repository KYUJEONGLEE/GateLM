import { BadRequestException } from '@nestjs/common';

export const PASSWORD_MIN_LENGTH = 15;
export const PASSWORD_MAX_LENGTH = 256;

export const PASSWORD_POLICY_MESSAGE =
  'Use at least 15 characters and avoid common or repeated passwords.';

const BLOCKED_PASSWORDS = new Set([
  '123456789012345',
  'adminadminadmin',
  'correcthorsebatterystaple',
  'gatelmgatelmgatelm',
  'letmeinletmeinletmein',
  'passwordpassword',
  'passwordpasswordpassword',
  'qwertyuiopasdfg',
  'welcome123456789',
]);

export function getPasswordPolicyViolation(
  password: string,
): 'common' | 'length' | null {
  const characterLength = Array.from(password).length;
  if (
    characterLength < PASSWORD_MIN_LENGTH ||
    characterLength > PASSWORD_MAX_LENGTH
  ) {
    return 'length';
  }

  const normalized = password.normalize('NFC').toLocaleLowerCase('en-US');
  if (
    BLOCKED_PASSWORDS.has(normalized) ||
    /^(.)\1+$/u.test(normalized) ||
    /^(.{1,4})\1{2,}$/u.test(normalized)
  ) {
    return 'common';
  }

  return null;
}

export function assertPasswordMeetsPolicy(password: string): void {
  if (getPasswordPolicyViolation(password)) {
    throw new BadRequestException({
      code: 'WEAK_PASSWORD',
      message: PASSWORD_POLICY_MESSAGE,
    });
  }
}
