import {
  assertPasswordMeetsPolicy,
  getPasswordPolicyViolation,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from './password-policy';

describe('password policy', () => {
  it('requires between 8 and 15 Unicode characters', () => {
    expect(getPasswordPolicyViolation('Abcd1!x')).toBe('length');
    expect(getPasswordPolicyViolation('Abcdefghijklmn1!')).toBe('length');
    expect(getPasswordPolicyViolation('Abcdef1!')).toBeNull();
    expect(getPasswordPolicyViolation('Abcdefghijklm1!')).toBeNull();
    expect(PASSWORD_MIN_LENGTH).toBe(8);
    expect(PASSWORD_MAX_LENGTH).toBe(15);
  });

  it('requires uppercase, lowercase, number, and ASCII special characters', () => {
    expect(getPasswordPolicyViolation('abcdef1!')).toBe('uppercase');
    expect(getPasswordPolicyViolation('ABCDEF1!')).toBe('lowercase');
    expect(getPasswordPolicyViolation('Abcdefg!')).toBe('number');
    expect(getPasswordPolicyViolation('Abcdefg1')).toBe('special');
    expect(getPasswordPolicyViolation('Abcdef1가')).toBe('special');
  });

  it('rejects every whitespace character', () => {
    expect(getPasswordPolicyViolation('Abcd 1!x')).toBe('whitespace');
    expect(getPasswordPolicyViolation('Abcd\t1!x')).toBe('whitespace');
  });

  it('allows repeated patterns when every explicit rule is satisfied', () => {
    expect(getPasswordPolicyViolation('Aa1!Aa1!')).toBeNull();
  });

  it('returns a stable public error without echoing the password', () => {
    expect(() => assertPasswordMeetsPolicy('abcdefgh')).toThrow(
      'Use 8 to 15 characters and include at least one uppercase letter, lowercase letter, number, and special character. Spaces are not allowed.',
    );
  });
});
