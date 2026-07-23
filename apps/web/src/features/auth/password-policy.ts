export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 15;

export function isPasswordPolicySatisfied(password: string): boolean {
  const characterLength = Array.from(password).length;
  return (
    characterLength >= PASSWORD_MIN_LENGTH &&
    characterLength <= PASSWORD_MAX_LENGTH &&
    !/\s/u.test(password) &&
    /[A-Z]/u.test(password) &&
    /[a-z]/u.test(password) &&
    /[0-9]/u.test(password) &&
    /[\x21-\x2f\x3a-\x40\x5b-\x60\x7b-\x7e]/u.test(password)
  );
}
