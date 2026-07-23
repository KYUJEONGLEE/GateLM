export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 15;
export const PASSWORD_POLICY_MESSAGE_KO =
  '비밀번호는 8자 이상 15자 이하이며, 영문 대문자·소문자·숫자·특수문자를 각각 1개 이상 포함해야 합니다. 공백은 사용할 수 없습니다.';

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
