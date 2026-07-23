import { BadRequestException } from '@nestjs/common';

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 15;

export const PASSWORD_POLICY_MESSAGE =
  'Use 8 to 15 characters and include at least one uppercase letter, lowercase letter, number, and special character. Spaces are not allowed.';

export type PasswordPolicyViolation =
  | 'length'
  | 'lowercase'
  | 'number'
  | 'special'
  | 'uppercase'
  | 'whitespace';

export function getPasswordPolicyViolation(
  password: string,
): PasswordPolicyViolation | null {
  const characterLength = Array.from(password).length;
  if (
    characterLength < PASSWORD_MIN_LENGTH ||
    characterLength > PASSWORD_MAX_LENGTH
  ) {
    return 'length';
  }

  if (/\s/u.test(password)) {
    return 'whitespace';
  }
  if (!/[A-Z]/u.test(password)) {
    return 'uppercase';
  }
  if (!/[a-z]/u.test(password)) {
    return 'lowercase';
  }
  if (!/[0-9]/u.test(password)) {
    return 'number';
  }
  if (!/[\x21-\x2f\x3a-\x40\x5b-\x60\x7b-\x7e]/u.test(password)) {
    return 'special';
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
