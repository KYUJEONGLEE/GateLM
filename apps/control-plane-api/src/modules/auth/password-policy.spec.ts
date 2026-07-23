import {
  assertPasswordMeetsPolicy,
  getPasswordPolicyViolation,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from './password-policy';

describe('password policy', () => {
  it('requires at least 15 Unicode characters', () => {
    expect(getPasswordPolicyViolation('12345678901234')).toBe('length');
    expect(getPasswordPolicyViolation('가나다라마바사아자차카타파하')).toBe(
      'length',
    );
    expect(
      getPasswordPolicyViolation('가나다라마바사아자차카타파하늘'),
    ).toBeNull();
    expect(PASSWORD_MIN_LENGTH).toBe(15);
  });

  it('keeps a bounded maximum without truncating', () => {
    expect(
      getPasswordPolicyViolation('a'.repeat(PASSWORD_MAX_LENGTH + 1)),
    ).toBe('length');
  });

  it('rejects common and repeated passwords even when they are long enough', () => {
    expect(getPasswordPolicyViolation('111111111111111')).toBe('common');
    expect(getPasswordPolicyViolation('passwordpassword')).toBe('common');
    expect(getPasswordPolicyViolation('abcdabcdabcdabcd')).toBe('common');
  });

  it('allows long passphrases without composition requirements', () => {
    expect(
      getPasswordPolicyViolation('잔잔한 호수 위를 걷는 푸른 고래'),
    ).toBeNull();
    expect(
      getPasswordPolicyViolation('four calm words make a private phrase'),
    ).toBeNull();
  });

  it('returns a stable public error without echoing the password', () => {
    expect(() => assertPasswordMeetsPolicy('111111111111111')).toThrow(
      'Use at least 15 characters and avoid common or repeated passwords.',
    );
  });
});
